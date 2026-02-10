import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const API_KEY = process.env.API_KEY
const ACCESS_TOKEN = process.env.ACCESS_TOKEN
const READ_ONLY_TOKEN = process.env.READ_ONLY_TOKEN
const MODEL_READ_ONLY_TOKEN = process.env.MODEL_READ_ONLY_TOKEN

const getTokens = (envValue: string | undefined): string[] => {
    if (!envValue) return []
    return envValue.split(',').map((t) => t.trim())
}

export async function middleware(request: NextRequest) {
    const { pathname } = request.nextUrl

    if (
        pathname.startsWith('/api/v1/inlet') ||
        pathname.startsWith('/api/v1/outlet') ||
        pathname.startsWith('/api/v1/models') ||
        pathname.startsWith('/api/v1/panel') ||
        pathname.startsWith('/api/v1/config') ||
        pathname.startsWith('/api/v1/users')
    ) {
        const isAdminPath =
            pathname.startsWith('/api/v1/panel') ||
            pathname.startsWith('/api/v1/config') ||
            pathname.startsWith('/api/v1/users') ||
            pathname.startsWith('/api/v1/models')

        const authHeader = request.headers.get('authorization')
        const providedKey = authHeader?.replace('Bearer ', '')

        if (!providedKey) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        if (isAdminPath) {
            const adminTokens = getTokens(ACCESS_TOKEN)
            const readOnlyTokens = getTokens(READ_ONLY_TOKEN)
            const modelReadOnlyTokens = getTokens(MODEL_READ_ONLY_TOKEN)

            if (
                adminTokens.length === 0 &&
                readOnlyTokens.length === 0 &&
                modelReadOnlyTokens.length === 0
            ) {
                console.error('Access tokens are not set')
                return NextResponse.json(
                    { error: 'Server configuration error' },
                    { status: 500 }
                )
            }

            // Maintenance path requires Full Access (Admin)
            if (pathname.startsWith('/api/v1/panel/database/maintenance')) {
                if (adminTokens.includes(providedKey)) {
                    return NextResponse.next()
                }
                return NextResponse.json(
                    { error: 'Forbidden: Full access required for maintenance' },
                    { status: 403 }
                )
            }

            if (adminTokens.includes(providedKey)) {
                return NextResponse.next()
            }

            if (readOnlyTokens.includes(providedKey)) {
                if (request.method === 'GET') {
                    return NextResponse.next()
                }
                return NextResponse.json(
                    { error: 'Forbidden: Read-only access' },
                    { status: 403 }
                )
            }

            if (modelReadOnlyTokens.includes(providedKey)) {
                if (pathname.startsWith('/api/v1/models')) {
                    if (request.method === 'GET') {
                        return NextResponse.next()
                    }
                    return NextResponse.json(
                        { error: 'Forbidden: Model read-only access' },
                        { status: 403 }
                    )
                }
                // Full access to other admin paths
                return NextResponse.next()
            }
        } else {
            // Inlet/Outlet use API_KEY
            const apiKeys = getTokens(API_KEY)
            if (apiKeys.length === 0) {
                console.error('API Key is not set')
                return NextResponse.json(
                    { error: 'Server configuration error' },
                    { status: 500 }
                )
            }

            if (apiKeys.includes(providedKey)) {
                return NextResponse.next()
            }
        }

        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    } else if (!pathname.startsWith('/api/')) {
        const adminTokens = getTokens(ACCESS_TOKEN)
        const readOnlyTokens = getTokens(READ_ONLY_TOKEN)
        const modelReadOnlyTokens = getTokens(MODEL_READ_ONLY_TOKEN)

        if (
            adminTokens.length === 0 &&
            readOnlyTokens.length === 0 &&
            modelReadOnlyTokens.length === 0
        ) {
            console.error('Access tokens are not set')
            return NextResponse.json(
                { error: 'Server configuration error' },
                { status: 500 }
            )
        }

        if (pathname === '/token') {
            return NextResponse.next()
        }

        const response = NextResponse.next()
        response.headers.set(
            'Cache-Control',
            'no-store, no-cache, must-revalidate, proxy-revalidate'
        )
        response.headers.set('Pragma', 'no-cache')
        response.headers.set('Expires', '0')

        return response
    } else if (pathname.startsWith('/api/config/key')) {
        return NextResponse.next()
    } else if (pathname.startsWith('/api/init')) {
        return NextResponse.next()
    }

    return NextResponse.next()
}

export const config = {
    matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
