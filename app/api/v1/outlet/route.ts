import { NextResponse } from 'next/server'
import { encode } from 'gpt-tokenizer/model/gpt-4'
import { Pool, PoolClient } from 'pg'
import { createClient } from '@vercel/postgres'
import { query, getClient, getGlobalConfig } from '@/lib/db/client'
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

        // Fetch global config before transaction
        const globalConfig = await getGlobalConfig()

        // Helper function to run queries using the same client
        const runQuery = async (text: string, params?: any[]) => {
            if (isVercel) {
                return (pgClient as ReturnType<typeof createClient>).query(text, params)
            } else {
                return (pgClient as PoolClient).query(text, params)
            }
        }

        await runQuery('BEGIN')

        const modelPriceResult = await runQuery(
            `SELECT id, name, input_price, output_price, per_msg_price 
             FROM model_prices 
             WHERE id = $1`,
            [modelId]
        )
        
        let modelPrice = modelPriceResult.rows[0]
        if (!modelPrice) {
            const defaultInputPrice = parseFloat(process.env.DEFAULT_MODEL_INPUT_PRICE || '60')
            const defaultOutputPrice = parseFloat(process.env.DEFAULT_MODEL_OUTPUT_PRICE || '60')
            modelPrice = {
                id: modelId,
                name: modelId,
                input_price: defaultInputPrice,
                output_price: defaultOutputPrice,
                per_msg_price: -1,
            }
        }

        const lastMessage = data.body.messages[data.body.messages.length - 1]

        let inputTokens: number = 0
        let outputTokens: number = 0
        let usageSource: 'usage_data' | 'tokenizer' = 'tokenizer'

        const usage = lastMessage.usage
        if (usage) {
            const tokenDetails = usage.token_details
            
            // Base counts from standard fields
            const promptBase = Number(
                usage.prompt_tokens ||
                tokenDetails?.prompt_token_count ||
                usage.prompt_token_count ||
                0
            )

            const candidatesBase = Number(
                usage.completion_tokens ||
                tokenDetails?.candidates_token_count ||
                usage.candidates_token_count ||
                0
            )

            const thoughts = Number(
                tokenDetails?.thoughts_token_count ||
                usage.thoughts_token_count ||
                0
            )

            // Calculate sums from details if available
            const promptDetailsSum = (tokenDetails?.prompt_tokens_details && Array.isArray(tokenDetails.prompt_tokens_details))
                ? tokenDetails.prompt_tokens_details.reduce((acc: number, d: any) => acc + Number(d.token_count || 0), 0)
                : 0

            const candidatesDetailsSum = (tokenDetails?.candidates_tokens_details && Array.isArray(tokenDetails.candidates_tokens_details))
                ? tokenDetails.candidates_tokens_details.reduce((acc: number, d: any) => acc + Number(d.token_count || 0), 0)
                : 0

            // Logic to determine if details are separate or included in base counts:
            // 1. If sum of details > base count, they are likely separate (e.g. nano banana case) -> SUM them.
            // 2. If sum of details <= base count, base likely already includes them (e.g. Gemini Flash case) -> use MAX.
            
            const finalInput = (promptDetailsSum > promptBase)
                ? (promptBase + promptDetailsSum)
                : Math.max(promptBase, promptDetailsSum)
            
            const finalOutputBase = (candidatesDetailsSum > candidatesBase)
                ? (candidatesBase + candidatesDetailsSum)
                : Math.max(candidatesBase, candidatesDetailsSum)

            if (finalInput > 0 || finalOutputBase > 0 || thoughts > 0) {
                inputTokens = finalInput
                outputTokens = finalOutputBase + thoughts
                usageSource = 'usage_data'
            }
        }

        // Fallback to tokenizer if usage data is missing or both are 0
        if (usageSource === 'tokenizer' || (inputTokens === 0 && outputTokens === 0)) {
            usageSource = 'tokenizer'
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
        const groupMapping = await runQuery(
            'SELECT g.* FROM groups g JOIN user_group_mapping ugm ON g.id = ugm.group_id WHERE ugm.user_id = $1',
            [userId]
        )
        const group = groupMapping.rows[0]

        let newBalance: number
        let source = 'personal'
        let transactionId: number | null = null

        if (group) {
            // 1. Try to deduct from group first
            const groupResult = await runQuery(
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
                const transResult = await runQuery(
                    `INSERT INTO transactions (user_id, group_id, type, source, amount, model_id)
                     VALUES ($1, $2, 'USAGE', 'GROUP', $3, $4)
                     RETURNING id`,
                    [userId, group.id, -actualCost, modelId]
                )
                transactionId = transResult.rows[0].id
            } else {
                // Fallback to personal balance
                const userResult = await runQuery(
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
                const transResult = await runQuery(
                    `INSERT INTO transactions (user_id, type, source, amount, model_id)
                     VALUES ($1, 'USAGE', 'PERSONAL', $2, $3)
                     RETURNING id`,
                    [userId, -actualCost, modelId]
                )
                transactionId = transResult.rows[0].id
            }
        } else {
            // No group, deduct from personal balance
            const userResult = await runQuery(
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
            const transResult = await runQuery(
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

        const usageRecordResult = await runQuery(
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

        // Update global usage total (only if within period)
        if (globalConfig && globalConfig.enable) {
            const recordDate = new Date().toISOString().split('T')[0]
            const startDate = globalConfig.startDate && globalConfig.startDate !== 'null' ? globalConfig.startDate : '0000-00-00'
            const expireDate = globalConfig.expireDate && globalConfig.expireDate !== 'null' ? globalConfig.expireDate : '9999-12-31'

            if (recordDate >= startDate && recordDate <= expireDate) {
                await runQuery(
                    "UPDATE system_stats SET value_decimal = value_decimal + CAST($1 AS DECIMAL(16,4)), updated_at = CURRENT_TIMESTAMP WHERE key = 'global_usage_total'",
                    [actualCost]
                )
            }
        }

        // Update transaction with record_id
        if (transactionId) {
            await runQuery(
                `UPDATE transactions SET record_id = $1 WHERE id = $2`,
                [recordId, transactionId]
            )
        }

        await runQuery('COMMIT')

        console.log(
            JSON.stringify({
                success: true,
                inputTokens,
                outputTokens,
                usageSource,
                actualCost,
                newBalance,
                message: 'Request successful',
            })
        )

        return NextResponse.json({
            success: true,
            inputTokens,
            outputTokens,
            usageSource,
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
