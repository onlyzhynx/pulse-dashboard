// In-process MCP server over Streamable HTTP, mounted on the Pulse Express app at
// /mcp. This is what makes MCP "all in one" with Docker: the same container that
// serves the dashboard + REST API also serves MCP on the same port — no separate
// service, nothing for the client to spawn. An agent connects to
// http://<host>:8787/mcp with `Authorization: Bearer <PULSE_API_TOKEN>`.
//
// Stateless: a fresh MCP Server + transport is created per POST (no SSE session to
// keep alive), which suits a read-only tools-only server and survives container
// restarts without sticky state.
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { TOOLS } from './tools.js'

const byName = new Map(TOOLS.map(t => [t.name, t]))

function buildServer(db) {
  const server = new Server({ name: 'pulse', version: '2.0.0' }, { capabilities: { tools: {} } })

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
  }))

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const tool = byName.get(req.params.name)
    if (!tool) return { isError: true, content: [{ type: 'text', text: `Unknown tool: ${req.params.name}` }] }
    try {
      const data = tool.run(db, req.params.arguments || {})
      return { content: [{ type: 'text', text: JSON.stringify(data) }] }
    } catch (e) {
      return { isError: true, content: [{ type: 'text', text: String(e?.message || e) }] }
    }
  })

  return server
}

export default function mcpHttpHandler(db) {
  return async (req, res) => {
    if (req.method !== 'POST') {
      // Stateless MCP uses POST only; no long-lived GET/SSE stream or DELETE session.
      res.status(405).set('Allow', 'POST').json({
        jsonrpc: '2.0', id: null,
        error: { code: -32000, message: 'Method not allowed — POST a JSON-RPC message (stateless MCP).' },
      })
      return
    }
    const server = buildServer(db)
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
    res.on('close', () => { transport.close(); server.close() })
    try {
      await server.connect(transport)
      await transport.handleRequest(req, res, req.body)
    } catch (e) {
      console.error('[mcp]', e)
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: '2.0', id: null, error: { code: -32603, message: String(e?.message || e) } })
      }
    }
  }
}
