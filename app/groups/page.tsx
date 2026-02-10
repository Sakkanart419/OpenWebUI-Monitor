'use client'

import { useState, useEffect } from 'react'
import {
    Table,
    Button,
    Card,
    Modal,
    Form,
    Input,
    InputNumber,
    message,
    Space,
    Popconfirm,
    Select,
    Tag,
} from 'antd'
import {
    PlusOutlined,
    EditOutlined,
    DeleteOutlined,
    UsergroupAddOutlined,
    SearchOutlined,
    UserAddOutlined,
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'

interface Group {
    id: string
    name: string
    admin_email: string
    balance: number
    alert_threshold: number
    created_at: string
}

interface User {
    id: string
    email: string
    name: string
    group_id?: string
}

export default function GroupsPage() {
    const { t } = useTranslation('common')
    const [loading, setLoading] = useState(false)
    const [groups, setGroups] = useState<Group[]>([])
    const [users, setUsers] = useState<User[]>([])
    const [isModalOpen, setIsModalOpen] = useState(false)
    const [isMemberModalOpen, setIsMemberModalOpen] = useState(false)
    const [editingGroup, setEditingGroup] = useState<Group | null>(null)
    const [selectedGroup, setSelectedGroup] = useState<Group | null>(null)
    const [isAddMemberModalOpen, setIsAddMemberModalOpen] = useState(false)
    const [memberSearchText, setMemberSearchText] = useState('')
    const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([])
    const [form] = Form.useForm()

    const fetchGroups = async () => {
        setLoading(true)
        try {
            const token = localStorage.getItem('access_token')
            const res = await fetch('/api/v1/groups', {
                headers: { Authorization: `Bearer ${token}` },
            })
            const result = await res.json()
            if (result.success) setGroups(result.data)
        } catch (err) {
            console.error('Fetch groups error:', err)
            message.error(t('groups.message.fetchError'))
        } finally {
            setLoading(false)
        }
    }

    const fetchUsers = async () => {
        try {
            const token = localStorage.getItem('access_token')
            const res = await fetch('/api/v1/users?all=true', {
                headers: { Authorization: `Bearer ${token}` },
            })
            const result = await res.json()
            if (result.users) setUsers(result.users)
        } catch (err) {
            console.error('Fetch users error:', err)
        }
    }

    useEffect(() => {
        fetchGroups()
        fetchUsers()
    }, [])

    const handleAddEdit = async (values: any) => {
        try {
            const token = localStorage.getItem('access_token')
            const res = await fetch('/api/v1/groups', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify(values),
            })
            const result = await res.json()
            if (result.success) {
                message.success(t('groups.message.saveSuccess'))
                setIsModalOpen(false)
                fetchGroups()
            } else {
                message.error(result.error)
            }
        } catch (err) {
            console.error('Save group error:', err)
            message.error(t('groups.message.saveError'))
        }
    }

    const handleDelete = async (id: string) => {
        try {
            const token = localStorage.getItem('access_token')
            const res = await fetch(`/api/v1/groups?id=${id}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${token}` },
            })
            const result = await res.json()
            if (result.success) {
                message.success(t('groups.message.deleteSuccess'))
                fetchGroups()
            } else {
                message.error(result.error)
            }
        } catch (err) {
            console.error('Delete group error:', err)
            message.error(t('groups.message.deleteError'))
        }
    }

    const handleAssignUser = async (userId: string, groupId: string | null) => {
        try {
            const token = localStorage.getItem('access_token')
            const res = await fetch('/api/v1/users/assign-group', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ user_id: userId, group_id: groupId || 'none' }),
            })
            const result = await res.json()
            if (result.success) {
                message.success(t('groups.message.assignSuccess'))
            } else {
                message.error(result.error)
            }
        } catch (err) {
            console.error('Assign user error:', err)
            message.error(t('groups.message.assignError'))
        }
    }

    const handleBulkAssign = async (userIds: string[], groupId: string | null) => {
        try {
            const token = localStorage.getItem('access_token')
            const promises = userIds.map((userId) =>
                fetch('/api/v1/users/assign-group', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${token}`,
                    },
                    body: JSON.stringify({
                        user_id: userId,
                        group_id: groupId || 'none',
                    }),
                }).then((res) => res.json())
            )

            const results = await Promise.all(promises)
            const failures = results.filter((r) => !r.success)

            if (failures.length === 0) {
                message.success(t('groups.message.assignSuccess'))
                return true
            } else {
                message.error(`${failures.length} users failed to update`)
                return false
            }
        } catch (err) {
            console.error('Bulk assign error:', err)
            message.error(t('groups.message.assignError'))
            return false
        }
    }

    const columns = [
        { title: t('groups.id'), dataIndex: 'id', key: 'id' },
        { title: t('groups.name'), dataIndex: 'name', key: 'name' },
        { title: t('groups.adminEmail'), dataIndex: 'admin_email', key: 'admin_email' },
        {
            title: t('users.balance'),
            dataIndex: 'balance',
            key: 'balance',
            render: (val: number) => `$${Number(val).toFixed(4)}`,
        },
        {
            title: t('groups.alertThreshold'),
            dataIndex: 'alert_threshold',
            key: 'alert_threshold',
            render: (val: number) => `$${Number(val).toFixed(2)}`,
        },
        {
            title: t('users.actions'),
            key: 'actions',
            render: (_: any, record: Group) => (
                <Space>
                    <Button
                        icon={<EditOutlined />}
                        onClick={() => {
                            setEditingGroup(record)
                            form.setFieldsValue(record)
                            setIsModalOpen(true)
                        }}
                    />
                    <Button
                        icon={<UsergroupAddOutlined />}
                        onClick={() => {
                            setSelectedGroup(record)
                            setIsMemberModalOpen(true)
                        }}
                    />
                    <Popconfirm
                        title={t('groups.deleteConfirm.title')}
                        onConfirm={() => handleDelete(record.id)}
                    >
                        <Button icon={<DeleteOutlined />} danger />
                    </Popconfirm>
                </Space>
            ),
        },
    ]

    return (
        <div className="max-w-6xl mx-auto px-4 py-8 pt-24 space-y-8">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-bold">{t('groups.title')}</h1>
                    <p className="text-slate-500">{t('groups.description')}</p>
                </div>
                <Button
                    type="primary"
                    icon={<PlusOutlined />}
                    onClick={() => {
                        setEditingGroup(null)
                        form.resetFields()
                        setIsModalOpen(true)
                    }}
                >
                    {t('groups.add')}
                </Button>
            </div>

            <Card className="shadow-sm">
                <Table
                    dataSource={groups}
                    columns={columns}
                    loading={loading}
                    rowKey="id"
                    pagination={{ pageSize: 10 }}
                />
            </Card>

            <Modal
                title={editingGroup ? t('groups.edit') : t('groups.add')}
                open={isModalOpen}
                onCancel={() => setIsModalOpen(false)}
                onOk={() => form.submit()}
            >
                <Form form={form} layout="vertical" onFinish={handleAddEdit}>
                    <Form.Item
                        name="id"
                        label={t('groups.id')}
                        rules={[{ required: true }]}
                    >
                        <Input disabled={!!editingGroup} />
                    </Form.Item>
                    <Form.Item
                        name="name"
                        label={t('groups.name')}
                        rules={[{ required: true }]}
                    >
                        <Input />
                    </Form.Item>
                    <Form.Item name="admin_email" label={t('groups.adminEmail')}>
                        <Input />
                    </Form.Item>
                    <Form.Item name="balance" label={t('users.balance')}>
                        <InputNumber style={{ width: '100%' }} precision={4} />
                    </Form.Item>
                    <Form.Item
                        name="alert_threshold"
                        label={t('groups.alertThreshold')}
                    >
                        <InputNumber style={{ width: '100%' }} min={0} />
                    </Form.Item>
                </Form>
            </Modal>

            <Modal
                title={`${t('groups.manageMembers')}: ${selectedGroup?.name}`}
                open={isMemberModalOpen}
                onCancel={() => setIsMemberModalOpen(false)}
                footer={null}
                width={800}
            >
                <div className="space-y-4">
                    <div className="flex justify-between items-center">
                        <p className="text-sm text-slate-500">
                            {t('groups.manageMembersDesc')}
                        </p>
                        <Space>
                            {selectedMemberIds.length > 0 && (
                                <Popconfirm
                                    title="Remove selected members?"
                                    onConfirm={async () => {
                                        await handleBulkAssign(selectedMemberIds, null)
                                        setSelectedMemberIds([])
                                        fetchUsers()
                                    }}
                                >
                                    <Button danger icon={<DeleteOutlined />}>
                                        Remove Selected ({selectedMemberIds.length})
                                    </Button>
                                </Popconfirm>
                            )}
                            <Button
                                type="primary"
                                icon={<UserAddOutlined />}
                                onClick={() => setIsAddMemberModalOpen(true)}
                            >
                                Add Member
                            </Button>
                        </Space>
                    </div>
                    <Table
                        dataSource={users.filter((u) => u.group_id === selectedGroup?.id)}
                        rowKey="id"
                        size="small"
                        rowSelection={{
                            selectedRowKeys: selectedMemberIds,
                            onChange: (keys) => setSelectedMemberIds(keys as string[]),
                        }}
                        columns={[
                            { title: t('users.name'), dataIndex: 'name' },
                            { title: t('users.email'), dataIndex: 'email' },
                            {
                                title: t('users.actions'),
                                key: 'action',
                                render: (_, user) => (
                                    <Popconfirm
                                        title="Remove from group?"
                                        onConfirm={async () => {
                                            await handleAssignUser(user.id, null)
                                            fetchUsers()
                                        }}
                                    >
                                        <Button type="link" danger icon={<DeleteOutlined />}>
                                            Remove
                                        </Button>
                                    </Popconfirm>
                                ),
                            },
                        ]}
                        pagination={{ pageSize: 10 }}
                    />
                </div>
            </Modal>

            <Modal
                title="Add Members to Group"
                open={isAddMemberModalOpen}
                onCancel={() => {
                    setIsAddMemberModalOpen(false)
                    setMemberSearchText('')
                }}
                footer={null}
                width={700}
            >
                <div className="space-y-4">
                    <Input
                        placeholder="Search by name or email..."
                        prefix={<SearchOutlined />}
                        value={memberSearchText}
                        onChange={(e) => setMemberSearchText(e.target.value)}
                    />
                    <Table
                        dataSource={users.filter((u) => {
                            const matchesSearch =
                                u.name.toLowerCase().includes(memberSearchText.toLowerCase()) ||
                                u.email.toLowerCase().includes(memberSearchText.toLowerCase())
                            return matchesSearch && u.group_id !== selectedGroup?.id
                        })}
                        rowKey="id"
                        size="small"
                        columns={[
                            { title: t('users.name'), dataIndex: 'name' },
                            { title: t('users.email'), dataIndex: 'email' },
                            {
                                title: 'Current Group',
                                dataIndex: 'group_id',
                                render: (gid: string) => {
                                    const g = groups.find((x) => x.id === gid)
                                    return g ? <Tag color="blue">{g.name}</Tag> : <Tag>No Group</Tag>
                                },
                            },
                            {
                                title: t('users.actions'),
                                key: 'action',
                                render: (_, user) => (
                                    <Button
                                        type="link"
                                        onClick={async () => {
                                            await handleAssignUser(user.id, selectedGroup?.id || null)
                                            fetchUsers()
                                        }}
                                    >
                                        {t('groups.addToGroup')}
                                    </Button>
                                ),
                            },
                        ]}
                        pagination={{ pageSize: 15, showSizeChanger: true, pageSizeOptions: ['15', '20', '25'] }}
                    />
                </div>
            </Modal>
        </div>
    )
}
