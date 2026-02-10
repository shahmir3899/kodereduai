import { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { financeApi } from '../services/api'

const SUGGESTIONS = [
  'How much fee is pending this month?',
  'Which students haven\'t paid?',
  'What is the collection rate?',
  'What were total expenses last month?',
]

export default function FinanceChatWidget() {
  const [isOpen, setIsOpen] = useState(false)
  const queryClient = useQueryClient()
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const messagesEndRef = useRef(null)

  // Load chat history (only when widget is open)
  const { data: history } = useQuery({
    queryKey: ['financeAIChatHistory'],
    queryFn: () => financeApi.getChatHistory(),
    enabled: isOpen,
  })

  useEffect(() => {
    if (history?.data) setMessages(history.data)
  }, [history])

  useEffect(() => {
    if (isOpen) messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isOpen])

  const sendMutation = useMutation({
    mutationFn: (message) => financeApi.sendChatMessage({ message }),
    onMutate: (message) => {
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
    <>
      {/* Floating Toggle Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-primary-600 text-white shadow-lg hover:bg-primary-700 flex items-center justify-center transition-all hover:scale-105"
        title="AI Finance Assistant"
      >
        {isOpen ? (
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        ) : (
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
          </svg>
        )}
      </button>

      {/* Chat Panel */}
      {isOpen && (
        <div
          className="fixed bottom-24 right-6 z-50 w-[85vw] sm:w-96 bg-white rounded-xl shadow-2xl border border-gray-200 flex flex-col"
          style={{ maxHeight: '70vh' }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 flex-shrink-0 bg-primary-600 rounded-t-xl">
            <div>
              <h3 className="text-sm font-semibold text-white">AI Finance Assistant</h3>
              <p className="text-xs text-primary-200">Ask about fees, expenses, payments</p>
            </div>
            {messages.length > 0 && (
              <button
                onClick={() => clearMutation.mutate()}
                disabled={clearMutation.isPending}
                className="text-xs text-primary-200 hover:text-white"
              >
                Clear
              </button>
            )}
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-3 space-y-3 min-h-[200px]">
            {messages.length === 0 ? (
              <div className="text-center py-6">
                <div className="w-12 h-12 bg-primary-100 rounded-full flex items-center justify-center mx-auto mb-3">
                  <svg className="w-6 h-6 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                  </svg>
                </div>
                <p className="text-sm text-gray-500 mb-3">Ask me anything about finances</p>
                <div className="flex flex-wrap justify-center gap-1.5">
                  {SUGGESTIONS.map(q => (
                    <button
                      key={q}
                      onClick={() => handleSend(q)}
                      className="px-2.5 py-1 bg-gray-100 text-gray-600 rounded-full text-xs hover:bg-gray-200 transition-colors"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <>
                {messages.map((msg, i) => (
                  <div
                    key={msg.id || i}
                    className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[85%] px-3 py-2 rounded-xl text-xs leading-relaxed whitespace-pre-wrap ${
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
                    <div className="bg-gray-100 text-gray-400 px-3 py-2 rounded-xl rounded-bl-sm text-xs">
                      <span className="inline-flex gap-1">
                        <span className="animate-bounce" style={{ animationDelay: '0ms' }}>.</span>
                        <span className="animate-bounce" style={{ animationDelay: '150ms' }}>.</span>
                        <span className="animate-bounce" style={{ animationDelay: '300ms' }}>.</span>
                      </span>
                    </div>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </>
            )}
          </div>

          {/* Input */}
          <div className="flex gap-2 p-3 border-t border-gray-200 flex-shrink-0">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask a question..."
              className="flex-1 input-field text-sm py-1.5"
              disabled={sendMutation.isPending}
            />
            <button
              onClick={() => handleSend()}
              disabled={!input.trim() || sendMutation.isPending}
              className="px-3 py-1.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </>
  )
}
