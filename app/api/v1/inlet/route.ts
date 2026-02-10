import { NextResponse } from 'next/server'
import { getOrCreateUser } from '@/lib/db/users'
import { query } from '@/lib/db/client'
import { getModelInletCost } from '@/lib/utils/inlet-cost'

export async function POST(req: Request) {
    try {
        // Global Quota Check
        const globalLimitEnable = process.env.GLOBAL_LIMIT_ENABLE === 'true'
        if (globalLimitEnable) {
            const globalLimitQuota = parseFloat(process.env.GLOBAL_LIMIT_QUOTA || '0')
            const globalLimitExpireDate = process.env.GLOBAL_LIMIT_EXPIRE_DATE

            // Check Expiration
            if (globalLimitExpireDate) {
                const expireDate = new Date(globalLimitExpireDate)
                if (new Date() > expireDate) {
                    throw new Error('Insufficient fund (Global quota expired)')
                }
            }

            // Check Quota
            const globalUsageResult = await query(
                "SELECT value_decimal FROM system_stats WHERE key = 'global_usage_total'"
            )
            const currentGlobalUsage = parseFloat(
                globalUsageResult.rows[0]?.value_decimal || '0'
            )

            if (currentGlobalUsage >= globalLimitQuota) {
                throw new Error('Insufficient fund (Global quota exceeded)')
            }
        }

        const data = await req.json()
        const user = await getOrCreateUser(data.user)
        const modelId = data.body?.model

        if (user.deleted) {
            return NextResponse.json({
                success: true,
                balance: -1,
                message: 'Request successful',
            })
        }

        // Check if user belongs to a group
        const groupMapping = await query(
            'SELECT g.* FROM groups g JOIN user_group_mapping ugm ON g.id = ugm.group_id WHERE ugm.user_id = $1',
            [user.id]
        )
        const group = groupMapping.rows[0]

        const inletCost = getModelInletCost(modelId)

        let finalBalance: number
        let source: string

        if (group) {
            // 1. Check group balance first
            if (Number(group.balance) >= inletCost) {
                finalBalance = Number(group.balance)
                source = 'group'
            } else {
                // 2. Fallback to check personal balance
                if (Number(user.balance) >= inletCost) {
                    finalBalance = Number(user.balance)
                    source = 'personal'
                } else {
                    throw new Error('Insufficient balance (both group and personal)')
                }
            }
        } else {
            // No group, check personal balance
            if (Number(user.balance) >= inletCost) {
                finalBalance = Number(user.balance)
                source = 'personal'
            } else {
                throw new Error('Insufficient balance')
            }
        }

        return NextResponse.json({
            success: true,
            balance: finalBalance,
            inlet_cost: inletCost,
            source: source,
            message: 'Request successful',
        })
    } catch (error) {
        console.error('Inlet error:', error)
        return NextResponse.json(
            {
                success: false,
                error:
                    error instanceof Error
                        ? error.message
                        : 'Error dealing with request',
                error_type:
                    error instanceof Error ? error.name : 'UNKNOWN_ERROR',
            },
            { status: 500 }
        )
    }
}
