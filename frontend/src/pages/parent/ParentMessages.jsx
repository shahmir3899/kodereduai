import { getSchoolTimeZone, schoolDateStr, schoolToday } from '../../utils/schoolTime'
import { useState, useEffect, useRef } from 'react'
import PageHeader from '../../components/ui/PageHeader'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { messagingApi } from '../../services/api'
import Spinner from '../../components/ui/Spinner'
import Button from '../../components/ui/Button'
import { useEscapeKey } from '../../hooks/useEscapeKey'

// A teacher can repeat across children, so the person and the child together identify a recipient.
const recipientKey = (r) => `${r.id}:${r.student_id ?? ''}`

export default function ParentMessages() {
  const queryClient = useQueryClient()
  const messagesEndRef = useRef(null)

  const [selectedThread, setSelectedThread] = useState(null)
  const [showNewMessage, setShowNewMessage] = useState(false)

  useEscapeKey(() => setShowNewMessage(false), showNewMessage)
  const [mobileView, setMobileView] = useState('threads') // 'threads' | 'messages'
  const [messageText, setMessageText] = useState('')

  // New message form. A teacher appears once per child, so the picker value pairs the two.
  const [newForm, setNewForm] = useState({ recipient_key: '', message: '' })

  // Same store the teachers and admins read (/api/messaging). The old /api/parents/messages
  // store had no recipient list and nobody reading it, so messages sent there went nowhere.
  const { data: recipientsData } = useQuery({
    queryKey: ['messagingRecipients'],
    queryFn: () => messagingApi.getRecipients(),
    enabled: showNewMessage,
  })

  const { data: threadsData, isLoading: threadsLoading } = useQuery({
    queryKey: ['messagingThreads'],
    queryFn: () => messagingApi.getThreads(),
  })

  const { data: messagesData, isLoading: messagesLoading } = useQuery({
    queryKey: ['messagingThread', selectedThread],
    queryFn: () => messagingApi.getThread(selectedThread),
    enabled: !!selectedThread,
    refetchInterval: 15000, // Auto-refresh every 15s
  })

  const recipients = recipientsData?.data?.results || recipientsData?.data || []
  const threads = threadsData?.data?.results || threadsData?.data || []
  const messages = messagesData?.data?.messages || []

  // Scroll to bottom when messages change
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages])

  const refreshThreads = () => {
    queryClient.invalidateQueries({ queryKey: ['messagingThreads'] })
    queryClient.invalidateQueries({ queryKey: ['messagingUnreadCount'] })
  }

  // Send message in existing thread
  const sendMutation = useMutation({
    mutationFn: ({ threadId, message }) => messagingApi.reply(threadId, { message }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['messagingThread', selectedThread] })
      refreshThreads()
      setMessageText('')
    },
  })

  // Send new message (start new thread, or continue the existing one with that teacher and child)
  const newMessageMutation = useMutation({
    mutationFn: (data) => messagingApi.createThread(data),
    onSuccess: (response) => {
      refreshThreads()
      setShowNewMessage(false)
      setNewForm({ recipient_key: '', message: '' })
      const threadId = response?.data?.id
      if (threadId) {
        setSelectedThread(threadId)
        setMobileView('messages')
      }
    },
  })

  const handleSendMessage = (e) => {
    e.preventDefault()
    if (!messageText.trim() || !selectedThread) return

    sendMutation.mutate({ threadId: selectedThread, message: messageText.trim() })
  }

  const handleNewMessage = (e) => {
    e.preventDefault()
    const recipient = recipients.find((r) => recipientKey(r) === newForm.recipient_key)
    if (!newForm.message.trim() || !recipient) return

    newMessageMutation.mutate({
      recipient_user_id: recipient.id,
      student_id: recipient.student_id || undefined,
      message: newForm.message.trim(),
    })
  }

  const selectThread = (threadId) => {
    setSelectedThread(threadId)
    setMobileView('messages')

    // Mark thread messages as read
    const thread = threads.find((t) => t.id === threadId)
    if (thread?.unread_count > 0) {
      messagingApi.markRead(threadId).catch(() => {})
      refreshThreads()
    }
  }

  const getSelectedThreadInfo = () => {
    return threads.find((t) => t.id === selectedThread)
  }

  const formatTime = (dateStr) => {
    if (!dateStr) return ''
    const date = new Date(dateStr)
    const now = new Date()
    const isToday = schoolDateStr(date) === schoolToday()
    if (isToday) {
      return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: getSchoolTimeZone() })
    }
    const yesterday = new Date(now)
    yesterday.setDate(yesterday.getDate() - 1)
    if (date.toDateString() === yesterday.toDateString()) {
      return 'Yesterday'
    }
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  const isMyMessage = (msg) => msg.is_mine === true

  return (
    <div className="space-y-6">
      {/* Back */}
      <Link to="/parent/dashboard" className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700">
        <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back to Dashboard
      </Link>

      {/* Header */}
      <PageHeader title="Messages" subtitle="Communicate with teachers" actions={<>
<Button onClick={() => setShowNewMessage(true)} aria-label="New Message">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          <span className="hidden sm:inline">New Message</span>
        </Button>
</>} />

      {/* New Message Modal */}
      {showNewMessage && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
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
              <div>
                <label className="label">Send to</label>
                <select
                  value={newForm.recipient_key}
                  onChange={(e) => setNewForm({ ...newForm, recipient_key: e.target.value })}
                  className="input"
                >
                  <option value="">-- Select a teacher --</option>
                  {recipients.map((r) => (
                    <option key={recipientKey(r)} value={recipientKey(r)}>
                      {r.name}{r.student_name ? ` — ${r.student_name}` : ''}
                    </option>
                  ))}
                </select>
                {recipients.length === 0 && (
                  <p className="text-xs text-gray-400 mt-1">No teachers are available to message yet.</p>
                )}
              </div>

              <div>
                <label className="label">Message</label>
                <textarea
                  value={newForm.message}
                  onChange={(e) => setNewForm({ ...newForm, message: e.target.value })}
                  rows={4}
                  placeholder="Type your message..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 resize-none"
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
                  disabled={!newForm.message.trim() || !newForm.recipient_key || newMessageMutation.isPending}
                  className="px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {newMessageMutation.isPending ? 'Sending...' : 'Send Message'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Messages Layout */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden" style={{ height: 'calc(100vh - 300px)', minHeight: '400px' }}>
        <div className="flex h-full">
          {/* Thread List Panel */}
          <div className={`w-full md:w-80 lg:w-96 border-r border-gray-200 flex flex-col ${
            mobileView === 'messages' ? 'hidden md:flex' : 'flex'
          }`}>
            <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
              <h3 className="text-sm font-semibold text-gray-700">Conversations</h3>
            </div>

            {threadsLoading ? (
              <div className="flex items-center justify-center py-12 flex-1">
                <Spinner size="sm" />
              </div>
            ) : threads.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
                <svg className="w-10 h-10 text-gray-300 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                </svg>
                <p className="text-sm text-gray-500">No conversations yet</p>
                <button
                  onClick={() => setShowNewMessage(true)}
                  className="text-sm text-primary-600 hover:text-primary-700 font-medium mt-2"
                >
                  Start a conversation
                </button>
              </div>
            ) : (
              <div className="overflow-y-auto flex-1">
                {threads.map((thread) => (
                  <button
                    key={thread.id}
                    onClick={() => selectThread(thread.id)}
                    className={`w-full text-left px-4 py-3 border-b border-gray-100 hover:bg-gray-50 transition-colors ${
                      selectedThread === thread.id ? 'bg-primary-50 border-l-2 border-l-primary-500' : ''
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0">
                        <span className="text-sm font-medium text-gray-600">
                          {(thread.other_participant_name || 'T').charAt(0).toUpperCase()}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-medium text-gray-900 truncate">
                            {thread.other_participant_name || 'Teacher'}
                          </p>
                          <span className="text-xs text-gray-400 flex-shrink-0 ml-2">
                            {formatTime(thread.latest_message_at || thread.created_at)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between mt-0.5">
                          <p className="text-xs text-gray-500 truncate">
                            {thread.latest_message || ''}
                          </p>
                          {thread.unread_count > 0 && (
                            <span className="ml-2 flex-shrink-0 w-5 h-5 bg-primary-600 text-white text-[10px] rounded-full flex items-center justify-center font-medium">
                              {thread.unread_count}
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
                  {/* Mobile back button */}
                  <button
                    onClick={() => { setMobileView('threads'); setSelectedThread(null) }}
                    aria-label="Back to conversations"
                    className="md:hidden p-1 rounded-lg hover:bg-gray-200 text-gray-500"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>
                  <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0">
                    <span className="text-sm font-medium text-gray-600">
                      {(getSelectedThreadInfo()?.other_participant_name || 'T').charAt(0).toUpperCase()}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-gray-900 truncate">
                      {getSelectedThreadInfo()?.other_participant_name || 'Teacher'}
                    </p>
                    {getSelectedThreadInfo()?.student_name && (
                      <p className="text-xs text-gray-500">Re: {getSelectedThreadInfo()?.student_name}</p>
                    )}
                  </div>
                </div>

                {/* Messages Area */}
                <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-50">
                  {messagesLoading ? (
                    <div className="flex items-center justify-center py-10">
                      <Spinner size="sm" />
                    </div>
                  ) : messages.length === 0 ? (
                    <div className="text-center py-10">
                      <p className="text-sm text-gray-500">No messages in this conversation yet.</p>
                    </div>
                  ) : (
                    messages.map((msg) => {
                      const isMine = isMyMessage(msg)
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

                {/* Send Message Form */}
                <form
                  onSubmit={handleSendMessage}
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
                            handleSendMessage(e)
                          }
                        }}
                        placeholder="Type a message..."
                        rows={1}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 resize-none"
                        style={{ maxHeight: '100px' }}
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={!messageText.trim() || sendMutation.isPending}
                      aria-label="Send reply"
                      className="p-2.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex-shrink-0"
                    >
                      {sendMutation.isPending ? (
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
                </form>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
