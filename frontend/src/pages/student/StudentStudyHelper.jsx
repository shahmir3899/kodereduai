import { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { studentPortalApi } from '../../services/api'

const SUGGESTIONS = [
  'Help me understand fractions',
  'Explain photosynthesis',
  'Quiz me on history',
  'How do I solve quadratic equations?',
  'What are the parts of a cell?',
  'Summarize the water cycle',
]

function formatTimestamp(dateStr) {
  if (!dateStr) return ''
  const date = new Date(dateStr)
  if (isNaN(date.getTime())) return ''
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

export default function StudentStudyHelper() {
  const queryClient = useQueryClient()
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [errorToast, setErrorToast] = useState('')
  const messagesEndRef = useRef(null)
  const inputRef = useRef(null)

  // Load chat history
  const { data: history, isLoading: historyLoading } = useQuery({
    queryKey: ['studyHelperHistory'],
    queryFn: () => studentPortalApi.getStudyHelperHistory(),
  })

  useEffect(() => {
    if (history?.data) {
      setMessages(Array.isArray(history.data) ? history.data : [])
    }
  }, [history])

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Auto-dismiss error toast
  useEffect(() => {
    if (!errorToast) return
    const timer = setTimeout(() => setErrorToast(''), 5000)
    return () => clearTimeout(timer)
  }, [errorToast])

  const sendMutation = useMutation({
    mutationFn: (message) => studentPortalApi.sendStudyHelperMessage({ message }),
    onMutate: (message) => {
      // Optimistically add user message
      setMessages(prev => [
        ...prev,
        {
          id: 'temp-user-' + Date.now(),
          role: 'user',
          content: message,
          created_at: new Date().toISOString(),
        },
      ])
    },
    onSuccess: (response) => {
      const data = response.data
      setMessages(prev => [
        ...prev,
        {
          id: data.id || 'temp-ai-' + Date.now(),
          role: 'assistant',
          content: data.response,
          created_at: new Date().toISOString(),
        },
      ])
    },
    onError: (error) => {
      const status = error?.response?.status
      if (status === 429) {
        setErrorToast('You are sending messages too quickly. Please wait a moment and try again.')
      } else if (status === 400) {
        setErrorToast('Your message was blocked by our content safety filter. Please rephrase and try again.')
      } else {
        setErrorToast('Something went wrong. Please try again.')
      }
      // Remove the optimistic user message on error
      setMessages(prev => prev.filter(m => !m.id?.startsWith('temp-user-')))
    },
  })

  const clearMutation = useMutation({
    mutationFn: () => studentPortalApi.clearStudyHelperHistory(),
    onSuccess: () => {
      setMessages([])
      queryClient.invalidateQueries({ queryKey: ['studyHelperHistory'] })
    },
    onError: () => {
      setErrorToast('Failed to clear chat history. Please try again.')
    },
  })

  const handleSend = (text) => {
    const msg = (text || input).trim()
    if (!msg || sendMutation.isPending) return
    if (msg.length > 2000) return
    setInput('')
    sendMutation.mutate(msg)
    inputRef.current?.focus()
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="flex flex-col h-[calc(100vh-10rem)] max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">AI Study Helper</h1>
          <p className="text-sm text-gray-500 mt-1">Your personal AI tutor</p>
        </div>
        {messages.length > 0 && (
          <button
            onClick={() => clearMutation.mutate()}
            disabled={clearMutation.isPending}
            className="px-3 py-1.5 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {clearMutation.isPending ? 'Clearing...' : 'Clear Chat'}
          </button>
        )}
      </div>

      {/* Error Toast */}
      {errorToast && (
        <div className="mb-3 bg-red-50 border border-red-200 rounded-xl p-3 flex items-center gap-3 animate-in">
          <svg className="w-5 h-5 text-red-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
          </svg>
          <p className="text-sm text-red-700 flex-1">{errorToast}</p>
          <button
            onClick={() => setErrorToast('')}
            className="p-1 rounded hover:bg-red-100 transition-colors flex-shrink-0"
          >
            <svg className="w-4 h-4 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Chat Area */}
      <div className="flex-1 overflow-y-auto bg-white rounded-xl border border-gray-200 p-4 mb-4">
        {historyLoading ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-3" />
              <p className="text-sm text-gray-400">Loading chat history...</p>
            </div>
          </div>
        ) : messages.length === 0 ? (
          /* Empty State */
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mb-4">
              <svg className="w-8 h-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
            </div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">Welcome to AI Study Helper!</h3>
            <p className="text-sm text-gray-500 mb-6 max-w-md">
              I'm here to help you learn and understand your subjects better.
              Ask me anything about your schoolwork, and I'll do my best to explain it clearly.
            </p>
            <p className="text-xs text-gray-400 mb-3 uppercase tracking-wider font-medium">Try asking</p>
            <div className="flex flex-wrap justify-center gap-2 max-w-lg">
              {SUGGESTIONS.map((q) => (
                <button
                  key={q}
                  onClick={() => handleSend(q)}
                  className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded-full text-sm hover:bg-blue-50 hover:text-blue-700 hover:border-blue-200 border border-transparent transition-colors"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          /* Messages */
          <div className="space-y-4">
            {messages.map((msg, i) => (
              <div
                key={msg.id || i}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div className={`max-w-[80%] ${msg.role === 'user' ? 'items-end' : 'items-start'} flex flex-col`}>
                  <div
                    className={`px-4 py-3 rounded-2xl text-sm whitespace-pre-wrap leading-relaxed ${
                      msg.role === 'user'
                        ? 'bg-blue-600 text-white rounded-br-sm'
                        : 'bg-gray-100 text-gray-800 rounded-bl-sm'
                    }`}
                  >
                    {msg.content}
                  </div>
                  {msg.created_at && (
                    <span className={`text-xs text-gray-400 mt-1 px-1 ${msg.role === 'user' ? 'text-right' : 'text-left'}`}>
                      {formatTimestamp(msg.created_at)}
                    </span>
                  )}
                </div>
              </div>
            ))}

            {/* Typing Indicator */}
            {sendMutation.isPending && (
              <div className="flex justify-start">
                <div className="bg-gray-100 text-gray-400 px-4 py-3 rounded-2xl rounded-bl-sm">
                  <div className="flex items-center gap-1">
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input Area */}
      <div className="bg-white rounded-xl border border-gray-200 p-3">
        <div className="flex gap-2 items-end">
          <div className="flex-1 relative">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => {
                if (e.target.value.length <= 2000) {
                  setInput(e.target.value)
                }
              }}
              onKeyDown={handleKeyDown}
              placeholder="Ask me anything about your studies..."
              rows={1}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none transition-colors"
              disabled={sendMutation.isPending}
              style={{
                minHeight: '42px',
                maxHeight: '120px',
                height: 'auto',
              }}
              onInput={(e) => {
                e.target.style.height = 'auto'
                e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px'
              }}
            />
          </div>
          <button
            onClick={() => handleSend()}
            disabled={!input.trim() || sendMutation.isPending || input.length > 2000}
            className="px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex-shrink-0"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
          </button>
        </div>
        <div className="flex items-center justify-between mt-1.5 px-1">
          <p className="text-xs text-gray-400">
            Press Enter to send, Shift+Enter for new line
          </p>
          <span className={`text-xs ${input.length > 1800 ? (input.length > 1950 ? 'text-red-500 font-medium' : 'text-yellow-600') : 'text-gray-400'}`}>
            {input.length}/2000
          </span>
        </div>
      </div>
    </div>
  )
}
