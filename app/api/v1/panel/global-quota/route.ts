import { NextResponse } from 'next/server'
import { query } from '@/lib/db/client'
import { verifyApiToken } from '@/lib/auth'

export async function GET(req: Request) {
    const authError = verifyApiToken(req)
    if (authError) {
        return authError
    }

    try {
        const globalLimitEnable = process.env.GLOBAL_LIMIT_ENABLE === 'true'
        const globalLimitQuota = parseFloat(process.env.GLOBAL_LIMIT_QUOTA || '0')
        const globalLimitExpireDate = process.env.GLOBAL_LIMIT_EXPIRE_DATE

        const globalUsageResult = await query(
            "SELECT value_decimal FROM system_stats WHERE key = 'global_usage_total'"
        )
        const currentGlobalUsage = parseFloat(
            globalUsageResult.rows[0]?.value_decimal || '0'
        )

        return NextResponse.json({
            success: true,
            data: {
                enabled: globalLimitEnable,
                quota: globalLimitQuota,
                usage: currentGlobalUsage,
                remaining: Math.max(0, globalLimitQuota - currentGlobalUsage),
                expireDate: globalLimitExpireDate,
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
