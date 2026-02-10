import { query, ensureTablesExist, syncGlobalUsage } from '@/lib/db/client'
import { NextResponse } from 'next/server'
import { verifyApiToken } from '@/lib/auth'

export async function POST(req: Request) {
    const authError = verifyApiToken(req, true)
    if (authError) {
        return authError
    }

    try {
        const { action, data } = await req.json()

        if (action === 'fix_schema') {
            await ensureTablesExist()
            return NextResponse.json({
                success: true,
                message: 'Database schema checked and fixed. All tables and columns are up to date.',
            })
        }

        if (action === 'sync_global_usage') {
            const total = await syncGlobalUsage()
            return NextResponse.json({
                success: true,
                message: `Global usage synchronized successfully. Total: ${total}`,
            })
        }

        if (action === 'export_all') {
            const users = await query('SELECT * FROM users ORDER BY id')
            const modelPrices = await query(
                'SELECT * FROM model_prices ORDER BY id'
            )
            const records = await query(
                'SELECT * FROM user_usage_records ORDER BY id'
            )
            const groups = await query('SELECT * FROM groups ORDER BY id')
            const mapping = await query('SELECT * FROM user_group_mapping')
            const transactions = await query(
                'SELECT * FROM transactions ORDER BY id'
            )

            const exportData = {
                version: '1.1',
                timestamp: new Date().toISOString(),
                data: {
                    users: users.rows,
                    model_prices: modelPrices.rows,
                    user_usage_records: records.rows,
                    groups: groups.rows,
                    user_group_mapping: mapping.rows,
                    transactions: transactions.rows,
                },
            }

            return NextResponse.json({
                success: true,
                data: exportData,
            })
        }

        if (action === 'export_models') {
            const modelPrices = await query(
                'SELECT id, name, input_price, output_price, per_msg_price, base_model_id FROM model_prices ORDER BY id'
            )
            return NextResponse.json({
                success: true,
                data: modelPrices.rows,
            })
        }

        if (action === 'import_models') {
            if (!Array.isArray(data)) {
                throw new Error('Invalid model data format')
            }

            await query('BEGIN')
            try {
                for (const model of data) {
                    await query(
                        `INSERT INTO model_prices (id, name, input_price, output_price, per_msg_price, base_model_id)
                         VALUES ($1, $2, $3, $4, $5, $6)
                         ON CONFLICT (id) DO UPDATE SET
                            name = EXCLUDED.name,
                            input_price = EXCLUDED.input_price,
                            output_price = EXCLUDED.output_price,
                            per_msg_price = EXCLUDED.per_msg_price,
                            base_model_id = EXCLUDED.base_model_id,
                            updated_at = CURRENT_TIMESTAMP`,
                        [
                            model.id,
                            model.name,
                            model.input_price,
                            model.output_price,
                            model.per_msg_price,
                            model.base_model_id,
                        ]
                    )
                }
                await query('COMMIT')
                return NextResponse.json({
                    success: true,
                    message: `Imported ${data.length} models successfully.`,
                })
            } catch (error) {
                await query('ROLLBACK')
                throw error
            }
        }

        return NextResponse.json(
            { success: false, error: 'Invalid action' },
            { status: 400 }
        )
    } catch (error) {
        console.error('Maintenance API error:', error)
        return NextResponse.json(
            {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
            },
            { status: 500 }
        )
    }
}
