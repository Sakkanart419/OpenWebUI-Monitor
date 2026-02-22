import { NextResponse } from 'next/server'
import { getOrCreateUser } from '@/lib/db/users'
import { query, getGlobalConfig } from '@/lib/db/client'
import { getModelInletCost } from '@/lib/utils/inlet-cost'

export async function POST(req: Request) {
    try {
        const data = await req.json()
        console.log('Inlet request received for user:', data.user?.id)

        // Global Quota Check
        const globalConfig = await getGlobalConfig()
        if (globalConfig && globalConfig.enable) {
            const globalLimitQuota = globalConfig.quota
            const globalLimitStartDate = globalConfig.startDate
            const globalLimitExpireDate = globalConfig.expireDate
            const now = new Date()

            // Check Start Date
            if (globalLimitStartDate && globalLimitStartDate !== 'null') {
                const startDate = new Date(globalLimitStartDate + ' 00:00:00')
                if (now < startDate) {
                    throw new Error('Insufficient fund (Global quota period not started)')
                }
            }

            // Check Expiration (end of day)
            if (globalLimitExpireDate && globalLimitExpireDate !== 'null') {
                const expireDate = new Date(globalLimitExpireDate + ' 23:59:59')
                if (now > expireDate) {
                    throw new Error('Insufficient fund (Global quota expired)')
                }
            }

            // Check Quota
            const currentGlobalUsage = globalConfig.usage
            if (currentGlobalUsage >= globalLimitQuota) {
                throw new Error('Insufficient fund (Global quota exceeded)')
            }
        }

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
