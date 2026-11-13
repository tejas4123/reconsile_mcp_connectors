import type { IncomingMessage, ServerResponse } from 'node:http'
import { handleNodeApiRequest } from '../server/handlers.ts'

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  return handleNodeApiRequest(req, res)
}

