import {
    createClient,
    QueryResult as VercelQueryResult,
} from '@vercel/postgres'
import { Pool, PoolClient } from 'pg'

const isVercel = process.env.VERCEL === '1'

let vercelPool: {
    client: ReturnType<typeof createClient>
    isConnected: boolean
} | null = null
let pgPool: Pool | null = null

async function getVercelClient() {
    if (!vercelPool) {
        vercelPool = {
            client: createClient(),
            isConnected: false,
        }
    }

    if (!vercelPool.isConnected) {
        try {
            await vercelPool.client.connect()
            vercelPool.isConnected = true
        } catch (error) {
            console.error('Vercel DB connection error:', error)
            throw error
        }
    }

    return vercelPool.client
}

function getClient() {
    if (isVercel) {
        return getVercelClient()
    } else {
        if (!pgPool) {
            const config = {
                host: process.env.POSTGRES_HOST || 'db',
                user: process.env.POSTGRES_USER || 'postgres',
                password: process.env.POSTGRES_PASSWORD,
                database: process.env.POSTGRES_DATABASE || 'openwebui_monitor',
                port: parseInt(process.env.POSTGRES_PORT || '5432'),
                max: 20,
                idleTimeoutMillis: 30000,
                connectionTimeoutMillis: 30000,
                statement_timeout: 30000,
            }

            if (process.env.POSTGRES_URL) {
                pgPool = new Pool({
                    connectionString: process.env.POSTGRES_URL,
                    ssl: {
                        rejectUnauthorized: false,
                    },
                    max: 20,
                    idleTimeoutMillis: 30000,
                    connectionTimeoutMillis: 30000,
                    statement_timeout: 30000,
                })
            } else {
                pgPool = new Pool(config)
            }

            pgPool.on('error', (err) => {
                console.error('Unexpected error on idle client', err)
                process.exit(-1)
            })
        }
        return pgPool
    }
}

type CommonQueryResult<T = any> = {
    rows: T[]
    rowCount: number
}

export async function query<T = any>(
    text: string,
    params?: any[]
): Promise<CommonQueryResult<T>> {
    const client = await getClient()
    const startTime = Date.now()

    if (isVercel) {
        try {
            const result = await (
                client as ReturnType<typeof createClient>
            ).query({
                text,
                values: params || [],
            })
            return {
                rows: result.rows,
                rowCount: result.rowCount || 0,
            }
        } catch (error) {
            console.error('[DB Query Error]', error)
            if (vercelPool) {
                vercelPool.isConnected = false
            }
            throw error
        }
    } else {
        let pgClient
        try {
            pgClient = await (client as Pool).connect()
            const result = await pgClient.query(text, params)
            return {
                rows: result.rows,
                rowCount: result.rowCount || 0,
            }
        } catch (error) {
            console.error('[DB Query Error]', error)
            console.error(`Query text: ${text}`)
            console.error(`Query params:`, params)
            throw error
        } finally {
            if (pgClient) {
                pgClient.release()
            }
        }
    }
}

if (typeof window === 'undefined') {
    process.on('SIGTERM', async () => {
        console.log('SIGTERM received, closing database connections')
        if (pgPool) {
            await pgPool.end()
        }
        if (vercelPool?.client) {
            await vercelPool.client.end()
            vercelPool.isConnected = false
        }
    })
}

export { getClient }

export async function ensureTablesExist() {
    try {
        // 1. Table: users
        await query(`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY);`)
        await query(
            `ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT NOT NULL DEFAULT '';`
        )
        await query(
            `ALTER TABLE users ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT '';`
        )
        await query(
            `ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user';`
        )
        await query(
            `ALTER TABLE users ADD COLUMN IF NOT EXISTS balance DECIMAL(16, 6) NOT NULL DEFAULT 0;`
        )
        await query(
            `ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;`
        )
        await query(
            `ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted BOOLEAN DEFAULT FALSE;`
        )
        await query(`CREATE INDEX IF NOT EXISTS users_email_idx ON users(email);`)

        // 2. Table: groups
        await query(`CREATE TABLE IF NOT EXISTS groups (id TEXT PRIMARY KEY);`)
        await query(
            `ALTER TABLE groups ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT '';`
        )
        await query(
            `ALTER TABLE groups ADD COLUMN IF NOT EXISTS balance DECIMAL(16, 4) NOT NULL DEFAULT 0;`
        )
        await query(`ALTER TABLE groups ADD COLUMN IF NOT EXISTS admin_email TEXT;`)
        await query(
            `ALTER TABLE groups ADD COLUMN IF NOT EXISTS alert_threshold DECIMAL(16, 4) DEFAULT 10.00;`
        )
        await query(
            `ALTER TABLE groups ADD COLUMN IF NOT EXISTS last_alerted_at TIMESTAMP WITH TIME ZONE;`
        )
        await query(
            `ALTER TABLE groups ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;`
        )

        // 3. Table: user_group_mapping
        await query(`
            CREATE TABLE IF NOT EXISTS user_group_mapping (
                user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE
            );
        `)
        await query(
            `ALTER TABLE user_group_mapping ADD COLUMN IF NOT EXISTS group_id TEXT REFERENCES groups(id) ON DELETE CASCADE;`
        )

        // 4. Table: model_prices
        await query(
            `CREATE TABLE IF NOT EXISTS model_prices (id TEXT PRIMARY KEY);`
        )
        await query(
            `ALTER TABLE model_prices ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT '';`
        )
        await query(
            `ALTER TABLE model_prices ADD COLUMN IF NOT EXISTS base_model_id TEXT;`
        )
        await query(
            `ALTER TABLE model_prices ADD COLUMN IF NOT EXISTS input_price NUMERIC(10, 6) DEFAULT 60.0;`
        )
        await query(
            `ALTER TABLE model_prices ADD COLUMN IF NOT EXISTS output_price NUMERIC(10, 6) DEFAULT 60.0;`
        )
        await query(
            `ALTER TABLE model_prices ADD COLUMN IF NOT EXISTS per_msg_price NUMERIC(10, 6) DEFAULT -1.0;`
        )
        await query(
            `ALTER TABLE model_prices ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;`
        )

        // 5. Table: user_usage_records
        await query(
            `CREATE TABLE IF NOT EXISTS user_usage_records (id SERIAL PRIMARY KEY);`
        )
        await query(
            `ALTER TABLE user_usage_records ADD COLUMN IF NOT EXISTS user_id TEXT NOT NULL REFERENCES users(id);`
        )
        await query(
            `ALTER TABLE user_usage_records ADD COLUMN IF NOT EXISTS nickname VARCHAR(255) NOT NULL DEFAULT '';`
        )
        await query(
            `ALTER TABLE user_usage_records ADD COLUMN IF NOT EXISTS use_time TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;`
        )
        await query(
            `ALTER TABLE user_usage_records ADD COLUMN IF NOT EXISTS model_name VARCHAR(255) NOT NULL DEFAULT '';`
        )
        await query(
            `ALTER TABLE user_usage_records ADD COLUMN IF NOT EXISTS input_tokens INTEGER NOT NULL DEFAULT 0;`
        )
        await query(
            `ALTER TABLE user_usage_records ADD COLUMN IF NOT EXISTS output_tokens INTEGER NOT NULL DEFAULT 0;`
        )
        await query(
            `ALTER TABLE user_usage_records ADD COLUMN IF NOT EXISTS cost DECIMAL(16, 4) NOT NULL DEFAULT 0;`
        )
        await query(
            `ALTER TABLE user_usage_records ADD COLUMN IF NOT EXISTS balance_after DECIMAL(16, 4) NOT NULL DEFAULT 0;`
        )

        // 6. Table: transactions
        await query(`CREATE TABLE IF NOT EXISTS transactions (id SERIAL PRIMARY KEY);`)
        await query(
            `ALTER TABLE transactions ADD COLUMN IF NOT EXISTS user_id TEXT REFERENCES users(id) ON DELETE CASCADE;`
        )
        await query(
            `ALTER TABLE transactions ADD COLUMN IF NOT EXISTS group_id TEXT REFERENCES groups(id) ON DELETE CASCADE;`
        )
        await query(
            `ALTER TABLE transactions ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'USAGE';`
        )
        await query(
            `ALTER TABLE transactions ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'PERSONAL';`
        )
        await query(
            `ALTER TABLE transactions ADD COLUMN IF NOT EXISTS amount DECIMAL(16, 4) NOT NULL DEFAULT 0;`
        )
        await query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS model_id TEXT;`)
        await query(
            `ALTER TABLE transactions ADD COLUMN IF NOT EXISTS record_id INTEGER;`
        )
        await query(
            `ALTER TABLE transactions ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;`
        )

        // 7. Table: topup_history
        await query(
            `CREATE TABLE IF NOT EXISTS topup_history (id SERIAL PRIMARY KEY);`
        )
        await query(
            `ALTER TABLE topup_history ADD COLUMN IF NOT EXISTS target_id TEXT NOT NULL DEFAULT '';`
        )
        await query(
            `ALTER TABLE topup_history ADD COLUMN IF NOT EXISTS target_type TEXT NOT NULL DEFAULT 'USER';`
        )
        await query(
            `ALTER TABLE topup_history ADD COLUMN IF NOT EXISTS amount DECIMAL(16, 4) NOT NULL DEFAULT 0;`
        )
        await query(
            `ALTER TABLE topup_history ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;`
        )

        // 8. Table: system_stats
        await query(`
            CREATE TABLE IF NOT EXISTS system_stats (
                key TEXT PRIMARY KEY,
                value_decimal DECIMAL(16, 4) DEFAULT 0.0000,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        `)

        // Initialize global_usage_total if it doesn't exist
        const result = await query(
            "SELECT key FROM system_stats WHERE key = 'global_usage_total'"
        )
        if (result.rows.length === 0) {
            // Calculate initial total from existing records
            const usageResult = await query(
                'SELECT COALESCE(SUM(cost), 0) as total FROM user_usage_records'
            )
            const total = usageResult.rows[0].total

            await query(
                "INSERT INTO system_stats (key, value_decimal) VALUES ('global_usage_total', $1)",
                [total]
            )
        }

        console.log('Database tables initialized successfully')
    } catch (error) {
        console.error('Failed to initialize database tables:', error)
        throw error
    }
}

export async function initDatabase() {
    try {
        await ensureTablesExist()
        console.log('Database initialized successfully')
    } catch (error) {
        console.error('Failed to initialize database:', error)
        throw error
    }
}

export async function syncGlobalUsage() {
    const usageResult = await query(
        'SELECT COALESCE(SUM(cost), 0) as total FROM user_usage_records'
    )
    const total = usageResult.rows[0].total

    await query(
        "UPDATE system_stats SET value_decimal = $1, updated_at = CURRENT_TIMESTAMP WHERE key = 'global_usage_total'",
        [total]
    )
    return total
}

export interface ModelPrice {
    id: string
    name: string
    input_price: number
    output_price: number
    per_msg_price: number
    updated_at: Date
}

export interface UserUsageRecord {
    id: number
    userId: number
    nickname: string
    useTime: Date
    modelName: string
    inputTokens: number
    outputTokens: number
    cost: number
    balanceAfter: number
}

export async function getOrCreateModelPrices(
    models: Array<{ id: string; name: string; base_model_id?: string }>
): Promise<ModelPrice[]> {
    try {
        const defaultInputPrice = parseFloat(
            process.env.DEFAULT_MODEL_INPUT_PRICE || '60'
        )
        const defaultOutputPrice = parseFloat(
            process.env.DEFAULT_MODEL_OUTPUT_PRICE || '60'
        )
        const defaultPerMsgPrice = parseFloat(
            process.env.DEFAULT_MODEL_PER_MSG_PRICE || '-1'
        )

        const modelIds = models.map((m) => m.id)
        const baseModelIds = models
            .map((m) => m.base_model_id)
            .filter((id) => id)

        const existingModelsResult = await query(
            `SELECT * FROM model_prices WHERE id = ANY($1::text[])`,
            [modelIds]
        )

        const baseModelsResult = await query(
            `SELECT * FROM model_prices WHERE id = ANY($1::text[])`,
            [baseModelIds]
        )

        const existingModels = new Map(
            existingModelsResult.rows.map((row) => [row.id, row])
        )
        const baseModels = new Map(
            baseModelsResult.rows.map((row) => [row.id, row])
        )

        const modelsToUpdate = models.filter((m) => existingModels.has(m.id))
        const missingModels = models.filter((m) => !existingModels.has(m.id))

        if (modelsToUpdate.length > 0) {
            for (const model of modelsToUpdate) {
                await query(`UPDATE model_prices SET name = $2 WHERE id = $1`, [
                    model.id,
                    model.name,
                ])
            }
        }

        if (missingModels.length > 0) {
            for (const model of missingModels) {
                const baseModel = model.base_model_id
                    ? baseModels.get(model.base_model_id)
                    : null

                await query(
                    `INSERT INTO model_prices (id, name, input_price, output_price, per_msg_price)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING *`,
                    [
                        model.id,
                        model.name,
                        baseModel?.input_price ?? defaultInputPrice,
                        baseModel?.output_price ?? defaultOutputPrice,
                        baseModel?.per_msg_price ?? defaultPerMsgPrice,
                    ]
                )
            }
        }

        const updatedModelsResult = await query(
            `SELECT * FROM model_prices WHERE id = ANY($1::text[])`,
            [modelIds]
        )

        return updatedModelsResult.rows.map((row) => ({
            id: row.id,
            name: row.name,
            input_price: Number(row.input_price),
            output_price: Number(row.output_price),
            per_msg_price: Number(row.per_msg_price),
            updated_at: row.updated_at,
        }))
    } catch (error) {
        console.error('Error in getOrCreateModelPrices:', error)
        throw error
    }
}

export async function updateModelPrice(
    id: string,
    input_price: number,
    output_price: number,
    per_msg_price: number
): Promise<ModelPrice | null> {
    try {
        const result = await query(
            `UPDATE model_prices 
       SET 
         input_price = CAST($2 AS NUMERIC(10,6)),
         output_price = CAST($3 AS NUMERIC(10,6)),
         per_msg_price = CAST($4 AS NUMERIC(10,6)),
         updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING *`,
            [id, input_price, output_price, per_msg_price]
        )

        if (result.rows[0]) {
            return {
                id: result.rows[0].id,
                name: result.rows[0].model_name,
                input_price: Number(result.rows[0].input_price),
                output_price: Number(result.rows[0].output_price),
                per_msg_price: Number(result.rows[0].per_msg_price),
                updated_at: result.rows[0].updated_at,
            }
        }
        return null
    } catch (error) {
        console.error('Error updating model price:', error)
        throw error
    }
}

export async function updateUserBalance(userId: string, balance: number) {
    try {
        const result = await query(
            `UPDATE users
       SET balance = $2
       WHERE id = $1
       RETURNING id, email, balance`,
            [userId, balance]
        )

        return result.rows[0]
    } catch (error) {
        console.error('Error in updateUserBalance:', error)
        throw error
    }
}

export const pool = {
    connect: async () => {
        if (isVercel) {
            return {
                query: async (text: string, params?: any[]) => {
                    const client = await getVercelClient()
                    const result = await client.query({
                        text,
                        values: params || [],
                    })
                    return result
                },
                release: () => {},
            }
        } else {
            return (pgPool || (getClient() as Pool)).connect()
        }
    },
    query: async (text: string, params?: any[]) => {
        if (isVercel) {
            const client = await getVercelClient()
            return client.query({
                text,
                values: params || [],
            })
        } else {
            return (pgPool || (getClient() as Pool)).query(text, params)
        }
    },
    end: async () => {
        if (isVercel) {
            if (vercelPool?.client) {
                await vercelPool.client.end()
                vercelPool.isConnected = false
            }
        } else if (pgPool) {
            await pgPool.end()
        }
    },
}
