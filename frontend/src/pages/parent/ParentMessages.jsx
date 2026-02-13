import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../contexts/AuthContext'
import { parentsApi } from '../../services/api'

export default function ParentMessages() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const messagesEndRef = useRef(null)

  const [selectedThread, setSelectedThread] = useState(null)
  const [showNewMessage, setShowNewMessage] = useState(false)
  const [mobileView, setMobileView] = useState('threads') // 'threads' | 'messages'
  const [messageText, setMessageText] = useState('')

  // New message form
  const [newForm, setNewForm] = useState({
    student_id: '',
    recipient_id: '',
    message: '',
  })

  // Fetch children
  const { data: childrenData } = useQuery({
    queryKey: ['myChildren'],
    queryFn: () => parentsApi.getMyChildren(),
  })

  // Fetch threads
  const { data: threadsData, isLoading: threadsLoading } = useQuery({
    queryKey: ['parentMessageThreads'],
    queryFn: () => parentsApi.getMessageThreads(),
  })

  // Fetch messages for selected thread
  const { data: messagesData, isLoading: messagesLoading } = useQuery({
    queryKey: ['parentThreadMessages', selectedThread],
    queryFn: () => parentsApi.getThreadMessages(selectedThread),
    enabled: !!selectedThread,
    refetchInterval: 15000, // Auto-refresh every 15s
  })

  const children = childrenData?.data?.results || childrenData?.data || []
  const threads = threadsData?.data?.results || threadsData?.data || []
  const messages = messagesData?.data?.messages || messagesData?.data?.results || messagesData?.data || []

  // Scroll to bottom when messages change
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages])

  // Send message in existing thread
  const sendMutation = useMutation({
    mutationFn: (data) => parentsApi.sendMessage(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['parentThreadMessages', selectedThread] })
      queryClient.invalidateQueries({ queryKey: ['parentMessageThreads'] })
      setMessageText('')
    },
  })

  // Send new message (start new thread)
  const newMessageMutation = useMutation({
    mutationFn: (data) => parentsApi.sendMessage(data),
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ['parentMessageThreads'] })
      setShowNewMessage(false)
      setNewForm({ student_id: '', recipient_id: '', message: '' })
      // Select the newly created thread if returned
      const threadId = response?.data?.thread_id || response?.data?.id
      if (threadId) {
        setSelectedThread(threadId)
        setMobileView('messages')
      }
    },
  })

  const handleSendMessage = (e) => {
    e.preventDefault()
    if (!messageText.trim()) return

    sendMutation.mutate({
      thread_id: selectedThread,
      message: messageText.trim(),
    })
  }

  const handleNewMessage = (e) => {
    e.preventDefault()
    if (!newForm.message.trim()) return

    newMessageMutation.mutate({
      student_id: newForm.student_id || undefined,
      recipient_id: newForm.recipient_id || undefined,
      message: newForm.message.trim(),
    })
  }

  const selectThread = (threadId) => {
    setSelectedThread(threadId)
    setMobileView('messages')

    // Mark thread messages as read
    const thread = threads.find((t) => t.id === threadId)
    if (thread?.unread_count > 0) {
      // Mark all as read via the last message or thread endpoint
      parentsApi.markMessageRead(threadId).catch(() => {})
      queryClient.invalidateQueries({ queryKey: ['parentMessageThreads'] })
    }
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

  const isMyMessage = (msg) => {
    return msg.sender_id === user?.id || msg.is_sender || msg.direction === 'SENT'
  }

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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Messages</h1>
          <p className="text-sm text-gray-500 mt-1">Communicate with teachers</p>
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
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Regarding Child</label>
                <select
                  value={newForm.student_id}
                  onChange={(e) => setNewForm({ ...newForm, student_id: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                >
                  <option value="">-- Select child (optional) --</option>
                  {children.map((child) => (
                    <option key={child.id} value={child.id}>
                      {child.name} ({child.class_name || 'N/A'})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Recipient</label>
                <input
                  type="text"
                  value={newForm.recipient_id}
                  onChange={(e) => setNewForm({ ...newForm, recipient_id: e.target.value })}
                  placeholder="Teacher name or ID"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                />
                <p className="text-xs text-gray-400 mt-1">Enter the teacher name or leave blank to message the class teacher.</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Message</label>
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
                  disabled={!newForm.message.trim() || newMessageMutation.isPending}
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
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" />
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
                          {(thread.recipient_name || thread.other_party || 'T').charAt(0).toUpperCase()}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-medium text-gray-900 truncate">
                            {thread.recipient_name || thread.other_party || 'Teacher'}
                          </p>
                          <span className="text-xs text-gray-400 flex-shrink-0 ml-2">
                            {formatTime(thread.last_message_at || thread.updated_at)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between mt-0.5">
                          <p className="text-xs text-gray-500 truncate">
                            {thread.last_message || thread.preview || ''}
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
                    className="md:hidden p-1 rounded-lg hover:bg-gray-200 text-gray-500"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>
                  <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0">
                    <span className="text-sm font-medium text-gray-600">
                      {(getSelectedThreadInfo()?.recipient_name || 'T').charAt(0).toUpperCase()}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-gray-900 truncate">
                      {getSelectedThreadInfo()?.recipient_name || getSelectedThreadInfo()?.other_party || 'Teacher'}
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
                      <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" />
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
                              {msg.message || msg.body || msg.content}
                            </p>
                            <p className={`text-[10px] mt-1 ${isMine ? 'text-primary-200' : 'text-gray-400'}`}>
                              {formatTime(msg.created_at || msg.sent_at)}
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
