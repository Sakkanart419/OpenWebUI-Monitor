import { NextResponse } from 'next/server'
import { getGlobalConfig } from '@/lib/db/client'
import { verifyApiToken } from '@/lib/auth'

export async function GET(req: Request) {
    const authError = verifyApiToken(req)
    if (authError) {
        return authError
    }

    try {
        const globalConfig = await getGlobalConfig()

        return NextResponse.json({
            success: true,
            data: {
                enabled: globalConfig.enable,
                quota: globalConfig.quota,
                usage: globalConfig.usage,
                remaining: Math.max(0, globalConfig.quota - globalConfig.usage),
                startDate: globalConfig.startDate,
                expireDate: globalConfig.expireDate,
            },
        })
    } catch (error) {
        console.error('Fetch global quota error:', error)
        return NextResponse.json(
            {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
            },
            { status: 500 }
        )
    }
}
