import { NextResponse } from 'next/server'

const ACCESS_TOKEN = process.env.ACCESS_TOKEN
const READ_ONLY_TOKEN = process.env.READ_ONLY_TOKEN
const MODEL_READ_ONLY_TOKEN = process.env.MODEL_READ_ONLY_TOKEN

const getTokens = (envValue: string | undefined): string[] => {
    if (!envValue) return []
    return envValue.split(',').map((t) => t.trim())
}

export function verifyApiToken(req: Request, requireFullAccess: boolean = false) {
    const adminTokens = getTokens(ACCESS_TOKEN)
    const readOnlyTokens = getTokens(READ_ONLY_TOKEN)
    const modelReadOnlyTokens = getTokens(MODEL_READ_ONLY_TOKEN)

    if (
        adminTokens.length === 0 &&
        readOnlyTokens.length === 0 &&
        modelReadOnlyTokens.length === 0
    ) {
        console.error('No access tokens are set')
        return NextResponse.json(
            { error: 'Server configuration error' },
            { status: 500 }
        )
    }

    const authHeader = req.headers.get('authorization')
    const token = authHeader?.replace('Bearer ', '')

    if (!token) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Admin has full access
    if (adminTokens.includes(token)) {
        return null
    }

    if (requireFullAccess) {
        return NextResponse.json(
            { error: 'Forbidden: Full access required' },
            { status: 403 }
        )
    }

    // Global Read-only
    if (readOnlyTokens.includes(token)) {
        if (req.method === 'GET') {
            return null
        }
        return NextResponse.json(
            { error: 'Forbidden: Read-only access' },
            { status: 403 }
        )
    }

    // Model Read-only: Only GET allowed for /models, others allowed for other paths
    if (modelReadOnlyTokens.includes(token)) {
        const url = new URL(req.url)
        if (url.pathname.startsWith('/api/v1/models')) {
            if (req.method === 'GET') {
                return null
            }
            return NextResponse.json(
                { error: 'Forbidden: Model read-only access' },
                { status: 403 }
            )
        }
        // Full access to other paths
        return null
    }

    console.log('Unauthorized access attempt')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}
