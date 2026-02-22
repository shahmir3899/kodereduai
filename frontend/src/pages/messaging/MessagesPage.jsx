import { useState, useEffect, useRef, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../contexts/AuthContext'
import { messagingApi } from '../../services/api'

const ROLE_BADGES = {
  SCHOOL_ADMIN: { label: 'Admin', color: 'bg-purple-100 text-purple-700' },
  PRINCIPAL: { label: 'Principal', color: 'bg-indigo-100 text-indigo-700' },
  TEACHER: { label: 'Teacher', color: 'bg-blue-100 text-blue-700' },
  PARENT: { label: 'Parent', color: 'bg-green-100 text-green-700' },
  STUDENT: { label: 'Student', color: 'bg-amber-100 text-amber-700' },
  HR_MANAGER: { label: 'HR', color: 'bg-rose-100 text-rose-700' },
  ACCOUNTANT: { label: 'Accountant', color: 'bg-teal-100 text-teal-700' },
  STAFF: { label: 'Staff', color: 'bg-gray-100 text-gray-700' },
}

function RoleBadge({ role }) {
  const badge = ROLE_BADGES[role] || { label: role, color: 'bg-gray-100 text-gray-600' }
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${badge.color}`}>
      {badge.label}
    </span>
  )
}

export default function MessagesPage() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const messagesEndRef = useRef(null)

  const [selectedThread, setSelectedThread] = useState(null)
  const [showNewMessage, setShowNewMessage] = useState(false)
  const [mobileView, setMobileView] = useState('threads')
  const [messageText, setMessageText] = useState('')
  const [searchText, setSearchText] = useState('')

  // New message form
  const [newForm, setNewForm] = useState({
    recipient_user_id: '',
    student_id: '',
    subject: '',
    message: '',
    message_type: 'GENERAL',
  })

  // Fetch threads
  const { data: threadsData, isLoading: threadsLoading } = useQuery({
    queryKey: ['messagingThreads'],
    queryFn: () => messagingApi.getThreads(),
  })

  // Fetch thread detail
  const { data: threadData, isLoading: threadLoading } = useQuery({
    queryKey: ['messagingThread', selectedThread],
    queryFn: () => messagingApi.getThread(selectedThread),
    enabled: !!selectedThread,
    refetchInterval: 15000,
  })

  // Fetch recipients when composing
  const { data: recipientsData, isLoading: recipientsLoading } = useQuery({
    queryKey: ['messagingRecipients'],
    queryFn: () => messagingApi.getRecipients(),
    enabled: showNewMessage,
  })

  const threads = threadsData?.data || []
  const threadDetail = threadData?.data || null
  const threadMessages = threadDetail?.messages || []
  const recipients = recipientsData?.data || []

  // Group recipients by role for the picker
  const groupedRecipients = useMemo(() => {
    const groups = {}
    recipients.forEach((r) => {
      const key = r.role
      if (!groups[key]) groups[key] = []
      groups[key].push(r)
    })
    return groups
  }, [recipients])

  // Filter threads by search
  const filteredThreads = useMemo(() => {
    if (!searchText.trim()) return threads
    const q = searchText.toLowerCase()
    return threads.filter(
      (t) =>
        (t.other_participant_name || '').toLowerCase().includes(q) ||
        (t.student_name || '').toLowerCase().includes(q) ||
        (t.subject || '').toLowerCase().includes(q) ||
        (t.latest_message || '').toLowerCase().includes(q)
    )
  }, [threads, searchText])

  // Scroll to bottom on new messages
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [threadMessages])

  // Reply mutation
  const replyMutation = useMutation({
    mutationFn: ({ threadId, message }) => messagingApi.reply(threadId, { message }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['messagingThread', selectedThread] })
      queryClient.invalidateQueries({ queryKey: ['messagingThreads'] })
      setMessageText('')
    },
  })

  // Create thread mutation
  const createThreadMutation = useMutation({
    mutationFn: (data) => messagingApi.createThread(data),
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ['messagingThreads'] })
      setShowNewMessage(false)
      setNewForm({ recipient_user_id: '', student_id: '', subject: '', message: '', message_type: 'GENERAL' })
      const threadId = response?.data?.id
      if (threadId) {
        setSelectedThread(threadId)
        setMobileView('messages')
      }
    },
  })

  const handleReply = (e) => {
    e.preventDefault()
    if (!messageText.trim() || !selectedThread) return
    replyMutation.mutate({ threadId: selectedThread, message: messageText.trim() })
  }

  const handleNewMessage = (e) => {
    e.preventDefault()
    if (!newForm.message.trim() || !newForm.recipient_user_id) return

    const data = {
      recipient_user_id: parseInt(newForm.recipient_user_id),
      message: newForm.message.trim(),
      message_type: newForm.message_type,
    }
    if (newForm.student_id) data.student_id = parseInt(newForm.student_id)
    if (newForm.subject.trim()) data.subject = newForm.subject.trim()

    createThreadMutation.mutate(data)
  }

  const selectThread = (threadId) => {
    setSelectedThread(threadId)
    setMobileView('messages')
    // Mark as read
    messagingApi.markRead(threadId).catch(() => {})
    queryClient.invalidateQueries({ queryKey: ['messagingThreads'] })
  }

  // When recipient is selected, auto-set message_type and student_id
  const handleRecipientChange = (recipientId) => {
    const recipient = recipients.find((r) => r.id === parseInt(recipientId))
    let messageType = 'GENERAL'
    let studentId = ''

    if (recipient) {
      if (recipient.role === 'PARENT') {
        messageType = 'TEACHER_PARENT'
        studentId = recipient.student_id || ''
      } else if (recipient.role === 'STUDENT') {
        messageType = 'TEACHER_STUDENT'
        studentId = recipient.student_id || ''
      } else if (['TEACHER', 'STAFF', 'HR_MANAGER', 'ACCOUNTANT'].includes(recipient.role)) {
        messageType = 'ADMIN_STAFF'
      }
    }

    setNewForm((prev) => ({
      ...prev,
      recipient_user_id: recipientId,
      message_type: messageType,
      student_id: studentId ? String(studentId) : '',
    }))
  }

  const getSelectedThreadInfo = () => {
    return threads.find((t) => t.id === selectedThread)
  }

  const formatTime = (dateStr) => {
    if (!dateStr) return ''
    const date = new Date(dateStr)
    const now = new Date()
    const isToday = date.toDateString() === now.toDateString()
    if (isToday) {
      return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
    }
    const yesterday = new Date(now)
    yesterday.setDate(yesterday.getDate() - 1)
    if (date.toDateString() === yesterday.toDateString()) {
      return 'Yesterday'
    }
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Messages</h1>
          <p className="text-sm text-gray-500 mt-0.5">Send and receive messages</p>
        </div>
        <button
          onClick={() => setShowNewMessage(true)}
          className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 transition-colors flex items-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          <span className="hidden sm:inline">New Message</span>
        </button>
      </div>

      {/* New Message Modal */}
      {showNewMessage && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-md shadow-xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">New Message</h2>
              <button
                onClick={() => setShowNewMessage(false)}
                className="p-1 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <form onSubmit={handleNewMessage} className="p-5 space-y-4">
              {/* Recipient Picker */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">To</label>
                {recipientsLoading ? (
                  <div className="flex items-center gap-2 py-2">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary-600" />
                    <span className="text-sm text-gray-400">Loading recipients...</span>
                  </div>
                ) : (
                  <select
                    value={newForm.recipient_user_id}
                    onChange={(e) => handleRecipientChange(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                    required
                  >
                    <option value="">-- Select recipient --</option>
                    {Object.entries(groupedRecipients).map(([role, members]) => (
                      <optgroup key={role} label={ROLE_BADGES[role]?.label || role}>
                        {members.map((r) => (
                          <option key={`${r.id}-${r.student_id || ''}`} value={r.id}>
                            {r.name}
                            {r.student_name ? ` (${r.student_name} - ${r.class_name || ''})` : ''}
                            {r.department ? ` - ${r.department}` : ''}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                )}
              </div>

              {/* Subject (optional) */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Subject (optional)</label>
                <input
                  type="text"
                  value={newForm.subject}
                  onChange={(e) => setNewForm({ ...newForm, subject: e.target.value })}
                  placeholder="e.g. Regarding attendance"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                />
              </div>

              {/* Student context info */}
              {newForm.student_id && (
                <div className="px-3 py-2 bg-blue-50 rounded-lg border border-blue-100">
                  <p className="text-xs text-blue-700">
                    Regarding: <span className="font-medium">
                      {recipients.find((r) => r.id === parseInt(newForm.recipient_user_id))?.student_name || 'Student'}
                    </span>
                  </p>
                </div>
              )}

              {/* Message */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Message</label>
                <textarea
                  value={newForm.message}
                  onChange={(e) => setNewForm({ ...newForm, message: e.target.value })}
                  rows={4}
                  placeholder="Type your message..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 resize-none"
                  required
                />
              </div>

              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowNewMessage(false)}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!newForm.message.trim() || !newForm.recipient_user_id || createThreadMutation.isPending}
                  className="px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {createThreadMutation.isPending ? 'Sending...' : 'Send Message'}
                </button>
              </div>

              {createThreadMutation.isError && (
                <p className="text-sm text-red-600">
                  {createThreadMutation.error?.response?.data?.error || 'Failed to send message. Please try again.'}
                </p>
              )}
            </form>
          </div>
        </div>
      )}

      {/* Messages Layout */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden" style={{ height: 'calc(100vh - 220px)', minHeight: '400px' }}>
        <div className="flex h-full">
          {/* Thread List Panel */}
          <div className={`w-full md:w-80 lg:w-96 border-r border-gray-200 flex flex-col ${
            mobileView === 'messages' ? 'hidden md:flex' : 'flex'
          }`}>
            {/* Search */}
            <div className="px-3 py-2.5 border-b border-gray-200 bg-gray-50">
              <div className="relative">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  type="text"
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  placeholder="Search conversations..."
                  className="w-full pl-9 pr-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                />
              </div>
            </div>

            {threadsLoading ? (
              <div className="flex items-center justify-center py-12 flex-1">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" />
              </div>
            ) : filteredThreads.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
                <svg className="w-10 h-10 text-gray-300 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                </svg>
                <p className="text-sm text-gray-500">
                  {searchText ? 'No matching conversations' : 'No conversations yet'}
                </p>
                {!searchText && (
                  <button
                    onClick={() => setShowNewMessage(true)}
                    className="text-sm text-primary-600 hover:text-primary-700 font-medium mt-2"
                  >
                    Start a conversation
                  </button>
                )}
              </div>
            ) : (
              <div className="overflow-y-auto flex-1">
                {filteredThreads.map((thread) => (
                  <button
                    key={thread.id}
                    onClick={() => selectThread(thread.id)}
                    className={`w-full text-left px-4 py-3 border-b border-gray-100 hover:bg-gray-50 transition-colors ${
                      selectedThread === thread.id ? 'bg-primary-50 border-l-2 border-l-primary-500' : ''
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-9 h-9 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0 mt-0.5">
                        <span className="text-sm font-medium text-gray-600">
                          {(thread.other_participant_name || '?').charAt(0).toUpperCase()}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <p className="text-sm font-medium text-gray-900 truncate">
                              {thread.other_participant_name || 'Unknown'}
                            </p>
                            {thread.other_participant_role && (
                              <RoleBadge role={thread.other_participant_role} />
                            )}
                          </div>
                          <span className="text-xs text-gray-400 flex-shrink-0">
                            {formatTime(thread.latest_message_at || thread.updated_at)}
                          </span>
                        </div>
                        {thread.subject && (
                          <p className="text-xs font-medium text-gray-600 mt-0.5 truncate">{thread.subject}</p>
                        )}
                        <div className="flex items-center justify-between mt-0.5">
                          <p className="text-xs text-gray-500 truncate">
                            {thread.latest_message || ''}
                          </p>
                          {thread.unread_count > 0 && (
                            <span className="ml-2 flex-shrink-0 w-5 h-5 bg-primary-600 text-white text-[10px] rounded-full flex items-center justify-center font-medium">
                              {thread.unread_count > 99 ? '99+' : thread.unread_count}
                            </span>
                          )}
                        </div>
                        {thread.student_name && (
                          <p className="text-[10px] text-gray-400 mt-0.5">Re: {thread.student_name}</p>
                        )}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Message Panel */}
          <div className={`flex-1 flex flex-col ${
            mobileView === 'threads' ? 'hidden md:flex' : 'flex'
          }`}>
            {!selectedThread ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-6">
                <svg className="w-16 h-16 text-gray-200 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                </svg>
                <p className="text-gray-500 text-sm">Select a conversation to view messages</p>
                <p className="text-gray-400 text-xs mt-1">or start a new conversation</p>
              </div>
            ) : (
              <>
                {/* Message Header */}
                <div className="px-4 py-3 border-b border-gray-200 bg-gray-50 flex items-center gap-3">
                  <button
                    onClick={() => { setMobileView('threads'); setSelectedThread(null) }}
                    className="md:hidden p-1 rounded-lg hover:bg-gray-200 text-gray-500"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>
                  <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0">
                    <span className="text-sm font-medium text-gray-600">
                      {(getSelectedThreadInfo()?.other_participant_name || '?').charAt(0).toUpperCase()}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <p className="text-sm font-semibold text-gray-900 truncate">
                        {getSelectedThreadInfo()?.other_participant_name || 'Unknown'}
                      </p>
                      {getSelectedThreadInfo()?.other_participant_role && (
                        <RoleBadge role={getSelectedThreadInfo()?.other_participant_role} />
                      )}
                    </div>
                    {(getSelectedThreadInfo()?.subject || getSelectedThreadInfo()?.student_name) && (
                      <p className="text-xs text-gray-500 truncate">
                        {getSelectedThreadInfo()?.subject && <span>{getSelectedThreadInfo().subject}</span>}
                        {getSelectedThreadInfo()?.subject && getSelectedThreadInfo()?.student_name && <span> &middot; </span>}
                        {getSelectedThreadInfo()?.student_name && <span>Re: {getSelectedThreadInfo().student_name}</span>}
                      </p>
                    )}
                  </div>
                </div>

                {/* Messages Area */}
                <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-50">
                  {threadLoading ? (
                    <div className="flex items-center justify-center py-10">
                      <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" />
                    </div>
                  ) : threadMessages.length === 0 ? (
                    <div className="text-center py-10">
                      <p className="text-sm text-gray-500">No messages in this conversation yet.</p>
                    </div>
                  ) : (
                    threadMessages.map((msg) => {
                      const isMine = msg.is_mine || msg.sender === user?.id
                      return (
                        <div
                          key={msg.id}
                          className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}
                        >
                          <div
                            className={`max-w-[80%] sm:max-w-[70%] rounded-2xl px-4 py-2.5 ${
                              isMine
                                ? 'bg-primary-600 text-white rounded-br-md'
                                : 'bg-white border border-gray-200 text-gray-900 rounded-bl-md'
                            }`}
                          >
                            {!isMine && msg.sender_name && (
                              <p className="text-xs font-medium text-primary-600 mb-0.5">
                                {msg.sender_name}
                              </p>
                            )}
                            <p className="text-sm whitespace-pre-wrap break-words">
                              {msg.body}
                            </p>
                            <p className={`text-[10px] mt-1 ${isMine ? 'text-primary-200' : 'text-gray-400'}`}>
                              {formatTime(msg.created_at)}
                            </p>
                          </div>
                        </div>
                      )
                    })
                  )}
                  <div ref={messagesEndRef} />
                </div>

                {/* Reply Form */}
                <form
                  onSubmit={handleReply}
                  className="px-4 py-3 border-t border-gray-200 bg-white"
                >
                  <div className="flex items-end gap-2">
                    <div className="flex-1">
                      <textarea
                        value={messageText}
                        onChange={(e) => setMessageText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault()
                            handleReply(e)
                          }
                        }}
                        placeholder="Type a reply..."
                        rows={1}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 resize-none"
                        style={{ maxHeight: '100px' }}
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={!messageText.trim() || replyMutation.isPending}
                      className="p-2.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex-shrink-0"
                    >
                      {replyMutation.isPending ? (
                        <svg className="w-5 h-5 animate-spin" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                      ) : (
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                        </svg>
                      )}
                    </button>
                  </div>
                  {replyMutation.isError && (
                    <p className="text-xs text-red-600 mt-1">Failed to send. Please try again.</p>
                  )}
                </form>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
