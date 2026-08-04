// Global fetch layer for /api/* — imported once from main.jsx (before App mounts).
//
// Fixes two long-standing issues without touching any widget:
//  1. Duplicate/refetch churn: several widgets independently fetch the same
//     endpoints (/api/networth, /api/bank/accounts, …) on mount and on 60s polls,
//     and every tab switch remounts widgets → full refetch. GETs are deduped
//     in-flight and cached briefly, so concurrent mounts share one request and
//     quick tab flips are instant.
//  2. Silent session expiry: the cookie lasts 7 days; after that every fetch
//     returned 401 and widgets just showed empty data forever. Any 401 from the
//     API now dispatches `pulse:unauthorized`, which AuthContext turns into the
//     login screen.
//
// Safety rules:
//  - Only GET /api/* is cached; /api/auth/* is never cached.
//  - Any non-GET /api/* call clears the whole cache (mutation → reads refetch).
//  - Non-OK responses are not cached (retries hit the network).
//  - Callers always receive res.clone() so each consumer can read the body.

const TTL_MS = 15_000
const cache = new Map() // url → { promise: Promise<Response>, at: number }

const rawFetch = window.fetch.bind(window)

function isApi(url) {
  return typeof url === 'string' && url.startsWith('/api/')
}

window.fetch = (input, init = {}) => {
  const url = typeof input === 'string' ? input : input?.url
  if (!isApi(url)) return rawFetch(input, init)

  const method = (init.method || (typeof input === 'object' && input?.method) || 'GET').toUpperCase()

  // ── Mutations: pass through, then invalidate all cached reads ──
  if (method !== 'GET') {
    return rawFetch(input, init).then(res => {
      cache.clear()
      if (res.status === 401 && !url.startsWith('/api/auth/')) {
        window.dispatchEvent(new Event('pulse:unauthorized'))
      }
      return res
    })
  }

  // ── GETs: dedupe + short TTL cache ──
  const cacheable = !url.startsWith('/api/auth/')
  const hit = cacheable ? cache.get(url) : null
  if (hit && Date.now() - hit.at < TTL_MS) {
    return hit.promise.then(res => res.clone())
  }

  const promise = rawFetch(input, init).then(res => {
    if (res.status === 401 && !url.startsWith('/api/auth/')) {
      window.dispatchEvent(new Event('pulse:unauthorized'))
    }
    if (!res.ok) cache.delete(url) // don't serve failures from cache
    return res
  }).catch(err => {
    cache.delete(url)
    throw err
  })

  if (cacheable) cache.set(url, { promise, at: Date.now() })
  return promise.then(res => res.clone())
}
