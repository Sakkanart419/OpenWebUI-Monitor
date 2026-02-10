import { NextResponse } from 'next/server'
import { encode } from 'gpt-tokenizer/model/gpt-4'
import { Pool, PoolClient } from 'pg'
import { createClient } from '@vercel/postgres'
import { query, getClient } from '@/lib/db/client'
import { getModelInletCost } from '@/lib/utils/inlet-cost'

const isVercel = process.env.VERCEL === '1'

interface Message {
    role: string
    content: string
}

interface ModelPrice {
    id: string
    name: string
    input_price: number
    output_price: number
    per_msg_price: number
}

type DbClient = ReturnType<typeof createClient> | Pool | PoolClient

async function getModelPrice(modelId: string): Promise<ModelPrice | null> {
    const result = await query(
        `SELECT id, name, input_price, output_price, per_msg_price 
     FROM model_prices 
     WHERE id = $1`,
        [modelId]
    )

    if (result.rows[0]) {
        return result.rows[0]
    }

    const defaultInputPrice = parseFloat(
        process.env.DEFAULT_MODEL_INPUT_PRICE || '60'
    )
    const defaultOutputPrice = parseFloat(
        process.env.DEFAULT_MODEL_OUTPUT_PRICE || '60'
    )

    if (
        isNaN(defaultInputPrice) ||
        defaultInputPrice < 0 ||
        isNaN(defaultOutputPrice) ||
        defaultOutputPrice < 0
    ) {
        return null
    }

    return {
        id: modelId,
        name: modelId,
        input_price: defaultInputPrice,
        output_price: defaultOutputPrice,
        per_msg_price: -1,
    }
}

export async function POST(req: Request) {
    const client = (await getClient()) as DbClient
    let pgClient: DbClient | null = null

    try {
        if (isVercel) {
            pgClient = client
        } else {
            pgClient = await (client as Pool).connect()
        }

        const data = await req.json()
        const modelId = data.body.model
        const userId = data.user.id
        const userName = data.user.name || 'Unknown User'

        await query('BEGIN')

        const modelPrice = await getModelPrice(modelId)
        if (!modelPrice) {
            throw new Error(`Fail to fetch price info of model ${modelId}`)
        }

        const lastMessage = data.body.messages[data.body.messages.length - 1]

        let inputTokens: number
        let outputTokens: number
        if (
            lastMessage.usage &&
            lastMessage.usage.prompt_tokens &&
            lastMessage.usage.completion_tokens
        ) {
            inputTokens = lastMessage.usage.prompt_tokens
            outputTokens = lastMessage.usage.completion_tokens
        } else {
            outputTokens = encode(lastMessage.content).length
            const totalTokens = data.body.messages.reduce(
                (sum: number, msg: Message) => sum + encode(msg.content).length,
                0
            )
            inputTokens = totalTokens - outputTokens
        }

        let totalCost: number
        if (outputTokens === 0) {
            totalCost = 0
            console.log('No charge for zero output tokens')
        } else if (modelPrice.per_msg_price >= 0) {
            totalCost = Number(modelPrice.per_msg_price)
            console.log(
                `Using fixed pricing: ${totalCost} (${modelPrice.per_msg_price} per message)`
            )
        } else {
            const inputCost = (inputTokens / 1_000_000) * modelPrice.input_price
            const outputCost =
                (outputTokens / 1_000_000) * modelPrice.output_price
            totalCost = inputCost + outputCost
        }

        const inletCost = getModelInletCost(modelId)

        const actualCost = totalCost + inletCost

        // Check if user belongs to a group
        const groupMapping = await query(
            'SELECT g.* FROM groups g JOIN user_group_mapping ugm ON g.id = ugm.group_id WHERE ugm.user_id = $1',
            [userId]
        )
        const group = groupMapping.rows[0]

        let newBalance: number
        let source = 'personal'
        let transactionId: number | null = null

        if (group) {
            // 1. Try to deduct from group first
            const groupResult = await query(
                `UPDATE groups 
                 SET balance = balance - CAST($1 AS DECIMAL(16,4))
                 WHERE id = $2 AND balance >= $1
                 RETURNING balance`,
                [actualCost, group.id]
            )

            if (groupResult.rows.length > 0) {
                newBalance = Number(groupResult.rows[0].balance)
                source = 'group'
                
                // Log transaction
                const transResult = await query(
                    `INSERT INTO transactions (user_id, group_id, type, source, amount, model_id)
                     VALUES ($1, $2, 'USAGE', 'GROUP', $3, $4)
                     RETURNING id`,
                    [userId, group.id, -actualCost, modelId]
                )
                transactionId = transResult.rows[0].id
            } else {
                // Fallback to personal balance
                const userResult = await query(
                    `UPDATE users 
                     SET balance = balance - CAST($1 AS DECIMAL(16,4))
                     WHERE id = $2 AND NOT deleted AND balance >= $1
                     RETURNING balance`,
                    [actualCost, userId]
                )

                if (userResult.rows.length === 0) {
                    throw new Error('Insufficient balance (both group and personal)')
                }
                newBalance = Number(userResult.rows[0].balance)
                
                // Log transaction
                const transResult = await query(
                    `INSERT INTO transactions (user_id, type, source, amount, model_id)
                     VALUES ($1, 'USAGE', 'PERSONAL', $2, $3)
                     RETURNING id`,
                    [userId, -actualCost, modelId]
                )
                transactionId = transResult.rows[0].id
            }
        } else {
            // No group, deduct from personal balance
            const userResult = await query(
                `UPDATE users 
                 SET balance = balance - CAST($1 AS DECIMAL(16,4))
                 WHERE id = $2 AND NOT deleted
                 RETURNING balance`,
                [actualCost, userId]
            )

            if (userResult.rows.length === 0) {
                throw new Error('User does not exist or insufficient balance')
            }
            newBalance = Number(userResult.rows[0].balance)

            // Log transaction
            const transResult = await query(
                `INSERT INTO transactions (user_id, type, source, amount, model_id)
                 VALUES ($1, 'USAGE', 'PERSONAL', $2, $3)
                 RETURNING id`,
                [userId, -actualCost, modelId]
            )
            transactionId = transResult.rows[0].id
        }

        if (newBalance > 999999.9999) {
            throw new Error('Balance exceeds maximum allowed value')
        }

        const usageRecordResult = await query(
            `INSERT INTO user_usage_records (
        user_id, nickname, model_name, 
        input_tokens, output_tokens, 
        cost, balance_after
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id`,
            [
                userId,
                userName,
                modelId,
                inputTokens,
                outputTokens,
                actualCost,
                newBalance,
            ]
        )

        const recordId = usageRecordResult.rows[0].id

        // Update global usage total
        await query(
            "UPDATE system_stats SET value_decimal = value_decimal + CAST($1 AS DECIMAL(16,4)), updated_at = CURRENT_TIMESTAMP WHERE key = 'global_usage_total'",
            [actualCost]
        )

        // Update transaction with record_id
        if (transactionId) {
            await query(
                `UPDATE transactions SET record_id = $1 WHERE id = $2`,
                [recordId, transactionId]
            )
        }

        await query('COMMIT')

        console.log(
            JSON.stringify({
                success: true,
                inputTokens,
                outputTokens,
                actualCost,
                newBalance,
                message: 'Request successful',
            })
        )

        return NextResponse.json({
            success: true,
            inputTokens,
            outputTokens,
            actualCost,
            newBalance,
            source,
            message: 'Request successful',
        })
    } catch (error) {
        await query('ROLLBACK')
        console.error('Outlet error:', error)
        return NextResponse.json(
            {
                success: false,
                error:
                    error instanceof Error
                        ? error.message
                        : 'Error processing request',
                error_type:
                    error instanceof Error ? error.name : 'UNKNOWN_ERROR',
            },
            { status: 500 }
        )
    } finally {
        if (!isVercel && pgClient && 'release' in pgClient) {
            pgClient.release()
        }
    }
}
