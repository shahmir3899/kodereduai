import { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../contexts/AuthContext'
import { financeApi } from '../services/api'

const SUGGESTIONS = [
  'How much fee is pending this month?',
  'What were total expenses last month?',
  'Which students haven\'t paid for this month?',
  'What is the current balance?',
  'Show salary expenses breakdown',
  'What is the collection rate this month?',
]

export default function FinanceAIPage() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const messagesEndRef = useRef(null)
  const inputRef = useRef(null)

  // Load chat history
  const { data: history, isLoading: historyLoading } = useQuery({
    queryKey: ['financeAIChatHistory'],
    queryFn: () => financeApi.getChatHistory(),
  })

  useEffect(() => {
    if (history?.data) {
      setMessages(history.data)
    }
  }, [history])

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const sendMutation = useMutation({
    mutationFn: (message) => financeApi.sendChatMessage({ message }),
    onMutate: (message) => {
      // Optimistically add user message
      setMessages(prev => [...prev, { role: 'user', content: message, id: 'temp-user-' + Date.now() }])
    },
    onSuccess: (response) => {
      const data = response.data
      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: data.response, id: data.message?.id || 'temp-ai-' + Date.now() }
      ])
    },
    onError: () => {
      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: 'Sorry, I encountered an error. Please try again.', id: 'error-' + Date.now() }
      ])
    },
  })

  const clearMutation = useMutation({
    mutationFn: () => financeApi.clearChatHistory(),
    onSuccess: () => {
      setMessages([])
      queryClient.invalidateQueries({ queryKey: ['financeAIChatHistory'] })
    },
  })

  const handleSend = (text) => {
    const msg = text || input.trim()
    if (!msg || sendMutation.isPending) return
    setInput('')
    sendMutation.mutate(msg)
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="flex flex-col h-[calc(100vh-10rem)]">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">AI Finance Assistant</h1>
          <p className="text-sm text-gray-600">Ask questions about your school's finances</p>
        </div>
        {messages.length > 0 && (
          <button
            onClick={() => clearMutation.mutate()}
            disabled={clearMutation.isPending}
            className="px-3 py-1.5 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            Clear Chat
          </button>
        )}
      </div>

      {/* Chat Area */}
      <div className="flex-1 overflow-y-auto bg-white rounded-lg border border-gray-200 p-4 mb-4">
        {historyLoading ? (
          <div className="text-center py-8 text-gray-400">Loading chat history...</div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="w-16 h-16 bg-primary-100 rounded-full flex items-center justify-center mb-4">
              <svg className="w-8 h-8 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
              </svg>
            </div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">Ask me anything about finances</h3>
            <p className="text-sm text-gray-500 mb-6 max-w-md">
              I can help with questions about fees, expenses, student payments, and financial summaries.
            </p>
            <div className="flex flex-wrap justify-center gap-2 max-w-lg">
              {SUGGESTIONS.map((q) => (
                <button
                  key={q}
                  onClick={() => handleSend(q)}
                  className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded-full text-sm hover:bg-gray-200 transition-colors"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((msg, i) => (
              <div
                key={msg.id || i}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[80%] px-4 py-3 rounded-2xl text-sm whitespace-pre-wrap ${
                    msg.role === 'user'
                      ? 'bg-primary-600 text-white rounded-br-sm'
                      : 'bg-gray-100 text-gray-800 rounded-bl-sm'
                  }`}
                >
                  {msg.content}
                </div>
              </div>
            ))}

            {/* Loading indicator */}
            {sendMutation.isPending && (
              <div className="flex justify-start">
                <div className="bg-gray-100 text-gray-400 px-4 py-3 rounded-2xl rounded-bl-sm text-sm">
                  <span className="inline-flex gap-1">
                    <span className="animate-bounce" style={{ animationDelay: '0ms' }}>.</span>
                    <span className="animate-bounce" style={{ animationDelay: '150ms' }}>.</span>
                    <span className="animate-bounce" style={{ animationDelay: '300ms' }}>.</span>
                  </span>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input Area */}
      <div className="flex gap-2">
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask about fees, expenses, payments..."
          className="flex-1 input-field"
          disabled={sendMutation.isPending}
        />
        <button
          onClick={() => handleSend()}
          disabled={!input.trim() || sendMutation.isPending}
          className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
          </svg>
        </button>
      </div>
    </div>
  )
}
