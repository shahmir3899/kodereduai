import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { assistantApi, streamMessage } from '../../services/assistantApi'
import { applyEvent, beginTurn, cardUpdated, initialState, loadMessages, pendingCards, reset } from './assistantState'

function reducer(state, action) {
  switch (action.type) {
    case 'begin': return beginTurn(state, action.text)
    case 'event': return applyEvent(state, action.event)
    case 'loaded': return loadMessages(state, action.data)
    case 'card': return cardUpdated(state, action.action)
    case 'reset': return reset()
    default: return state
  }
}

function errorText(err, fallback) {
  return err?.response?.data?.error || err?.response?.data?.detail || err?.message || fallback
}

/**
 * Everything the orb needs: the conversation, the live turn, and approve/edit/reject on cards.
 * `enabled` gates every request, so a school or role without the assistant makes no calls.
 */
export default function useAssistant({ enabled, open }) {
  const [state, dispatch] = useReducer(reducer, initialState)
  const [conversationId, setConversationId] = useState(null)
  const [cardNotes, setCardNotes] = useState({})      // card id -> { busy, error }
  const abortRef = useRef(null)
  const loadedRef = useRef(false)

  const { data: capabilities } = useQuery({
    queryKey: ['assistant', 'capabilities'],
    queryFn: async () => (await assistantApi.capabilities()).data,
    enabled,
    staleTime: 5 * 60 * 1000,
    retry: false,
  })

  // Pick up the latest conversation the first time the panel opens.
  useEffect(() => {
    if (!enabled || !open || loadedRef.current) return
    loadedRef.current = true
    ;(async () => {
      try {
        const list = (await assistantApi.listConversations()).data
        if (list.length) {
          setConversationId(list[0].id)
          dispatch({ type: 'loaded', data: (await assistantApi.getMessages(list[0].id)).data })
        }
      } catch {
        // No history is not fatal: the first message starts a new conversation.
      }
    })()
  }, [enabled, open])

  useEffect(() => () => abortRef.current?.abort(), [])

  const send = useCallback(async (text) => {
    const message = text.trim()
    if (!message || state.status === 'working') return
    let id = conversationId
    try {
      if (!id) {
        id = (await assistantApi.createConversation()).data.id
        setConversationId(id)
      }
    } catch (err) {
      dispatch({ type: 'begin', text: message })
      dispatch({ type: 'event', event: { type: 'error', message: errorText(err, 'Could not start a conversation.') } })
      return
    }
    dispatch({ type: 'begin', text: message })
    abortRef.current = new AbortController()
    try {
      await streamMessage(id, message, (event) => dispatch({ type: 'event', event }), abortRef.current.signal)
    } catch (err) {
      if (err?.name !== 'AbortError') {
        dispatch({ type: 'event', event: { type: 'error', message: errorText(err, 'The assistant could not answer.') } })
      }
    }
  }, [conversationId, state.status])

  const runCardAction = useCallback(async (id, call) => {
    setCardNotes((n) => ({ ...n, [id]: { busy: true, error: null } }))
    try {
      const { data } = await call()
      dispatch({ type: 'card', action: data })
      setCardNotes((n) => ({ ...n, [id]: { busy: false, error: null } }))
    } catch (err) {
      const body = err?.response?.data
      // 409 "changed": the server rebuilt the card from fresh data - show it instead of failing.
      if (body?.action) dispatch({ type: 'card', action: body.action })
      setCardNotes((n) => ({ ...n, [id]: { busy: false, error: errorText(err, 'That did not work. Please try again.') } }))
    }
  }, [])

  const approve = useCallback((id) => runCardAction(id, () => assistantApi.approveAction(id)), [runCardAction])
  const reject = useCallback((id) => runCardAction(id, () => assistantApi.rejectAction(id)), [runCardAction])
  const edit = useCallback((id, edits) => runCardAction(id, () => assistantApi.editAction(id, edits)), [runCardAction])

  const newChat = useCallback(() => {
    abortRef.current?.abort()
    setConversationId(null)
    setCardNotes({})
    dispatch({ type: 'reset' })
  }, [])

  return {
    state, capabilities, cardNotes, send, approve, reject, edit, newChat,
    pending: pendingCards(state).length,
  }
}
