import { useState, useEffect, useRef } from 'react'
import Widget from '../layout/Widget'
import { fmt } from '../../utils/formatters'

const MAJORS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT']
const LABELS = { BTCUSDT: 'BTC', ETHUSDT: 'ETH', SOLUSDT: 'SOL', BNBUSDT: 'BNB' }
const RECONNECT_DELAY = 3000

export default function CryptoTickerWidget() {
  const [prices, setPrices] = useState({})
  const [flash, setFlash] = useState({})
  const [status, setStatus] = useState('connecting') // 'connecting' | 'live' | 'reconnecting'
  const prevPrices = useRef({})
  const wsRef = useRef(null)
  const retryRef = useRef(null)
  const mountedRef = useRef(true)
  const statusRef = useRef('connecting')

  // REST fallback via the server (works even when Binance WS is blocked client-side)
  const fetchRest = async () => {
    try {
      const r = await fetch('/api/crypto/markets')
      if (!r.ok || !mountedRef.current) return
      const { markets } = await r.json()
      if (!Array.isArray(markets)) return
      setPrices(prev => {
        const next = { ...prev }
        for (const m of markets) {
          if (!m?.symbol) continue
          next[m.symbol] = { price: parseFloat(m.lastPrice), change: parseFloat(m.priceChangePercent) }
        }
        return next
      })
    } catch {}
  }

  const connect = () => {
    if (!mountedRef.current) return
    setStatus(ws => ws === 'live' ? 'reconnecting' : 'connecting')

    const streams = MAJORS.map(s => `${s.toLowerCase()}@ticker`).join('/')
    const ws = new WebSocket(`wss://stream.binance.com:9443/stream?streams=${streams}`)
    wsRef.current = ws

    ws.onopen = () => {
      if (!mountedRef.current) { ws.close(); return }
      setStatus('live')
    }

    ws.onmessage = (e) => {
      if (!mountedRef.current) return
      try {
        const { data: payload } = JSON.parse(e.data)
        const symbol = payload.s
        const price = parseFloat(payload.c)
        const change = parseFloat(payload.P)

        setPrices(prev => {
          const prevPrice = prevPrices.current[symbol]
          if (prevPrice !== undefined && prevPrice !== price) {
            const dir = price > prevPrice ? 'up' : 'down'
            setFlash(f => ({ ...f, [symbol]: dir }))
            setTimeout(() => setFlash(f => ({ ...f, [symbol]: null })), 600)
          }
          prevPrices.current[symbol] = price
          return { ...prev, [symbol]: { price, change } }
        })
      } catch {}
    }

    ws.onerror = () => {
      ws.close()
    }

    ws.onclose = () => {
      if (!mountedRef.current) return
      setStatus('reconnecting')
      retryRef.current = setTimeout(connect, RECONNECT_DELAY)
    }
  }

  useEffect(() => { statusRef.current = status }, [status])

  useEffect(() => {
    mountedRef.current = true
    connect()
    fetchRest()  // seed immediately so prices show before/without the socket
    // Keep refreshing via REST while the socket isn't live
    const poll = setInterval(() => { if (statusRef.current !== 'live') fetchRest() }, 15000)
    return () => {
      mountedRef.current = false
      clearInterval(poll)
      clearTimeout(retryRef.current)
      if (wsRef.current) {
        wsRef.current.onclose = null // prevent reconnect loop on unmount
        wsRef.current.close()
      }
    }
  }, [])

  return (
    <Widget
      title="Markets"
      subtitle={
        status === 'live' ? undefined :
        Object.keys(prices).length ? '↻ delayed' :
        status === 'reconnecting' ? '↻ reconnecting…' : '⋯ connecting'
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
        {MAJORS.map(sym => {
          const d = prices[sym]
          const isUp = (d?.change ?? 0) >= 0
          const flashDir = flash[sym]
          return (
            <div
              key={sym}
              className={flashDir === 'up' ? 'flash-up' : flashDir === 'down' ? 'flash-down' : ''}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '8px 4px',
                borderBottom: '1px solid var(--border)',
                transition: 'background 0.15s',
              }}
            >
              <span style={{ fontSize: '14px', color: 'var(--text-muted)', letterSpacing: '0.08em', minWidth: '40px' }}>
                {LABELS[sym]}
              </span>
              <span style={{ fontSize: '16px', color: 'var(--text)', fontFamily: 'var(--font-num)' }}>
                {d ? fmt.price(d.price) : '—'}
              </span>
              <span style={{ fontSize: '14px', color: isUp ? 'var(--positive)' : 'var(--negative)', minWidth: '52px', textAlign: 'right' }}>
                {d ? `${isUp ? '+' : ''}${d.change.toFixed(2)}%` : '—'}
              </span>
            </div>
          )
        })}
      </div>
    </Widget>
  )
}
