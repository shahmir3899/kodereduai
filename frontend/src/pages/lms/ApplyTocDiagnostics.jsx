/**
 * DIAGNOSTIC COMPONENT: ApplyToc Mutation Flow Tracing
 * 
 * Purpose: Trace execution flow when "Apply to Book" button is clicked
 * to identify where the API call is being blocked or dropped.
 * 
 * Add this component as a sibling to CurriculumPage to test in isolation.
 * Or temporarily import and render it in CurriculumPage for full integration test.
 */

import { useState, useRef } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { lmsApi } from '../../services/api'

const ApplyTocDiagnostics = () => {
  const [testBookId, setTestBookId] = useState('')
  const [testPayload, setTestPayload] = useState(null)
  const [executionLog, setExecutionLog] = useState([])
  const [mutationState, setMutationState] = useState({
    isPending: false,
    isError: false,
    isSuccess: false,
    error: null,
    data: null,
  })
  const queryClient = useQueryClient()
  const logRef = useRef([])

  const addLog = (step, details = {}) => {
    const entry = {
      timestamp: new Date().toISOString(),
      step,
      ...details,
    }
    logRef.current.push(entry)
    setExecutionLog([...logRef.current])
    console.log(`[DIAG] ${step}`, details)
  }

  // ============ MUTATION WITH DETAILED LOGGING ============
  const diagnosticMutation = useMutation({
    mutationFn: ({ id, data }) => {
      addLog('MUTATION_FN_START', { receivedId: id, payloadSize: JSON.stringify(data).length })

      // Test 1: Verify lmsApi.applyTOC exists and is callable
      if (typeof lmsApi.applyTOC !== 'function') {
        throw new Error('lmsApi.applyTOC is not a function')
      }
      addLog('MUTATION_FN_API_CHECK', { isFunction: true })

      // Test 2: Make the actual API call
      const promise = lmsApi.applyTOC(id, data)
      addLog('MUTATION_FN_CALLED_API', {
        method: 'POST',
        endpoint: `/api/lms/books/${id}/apply_toc/`,
        hasPromise: promise instanceof Promise,
      })

      // Test 3: Monitor the promise lifecycle
      promise
        .then((response) => {
          addLog('PROMISE_RESOLVED', { status: response.status, dataKeys: Object.keys(response.data || {}) })
        })
        .catch((error) => {
          addLog('PROMISE_REJECTED', {
            status: error.response?.status,
            message: error.message,
            detail: error.response?.data?.detail,
          })
        })

      return promise
    },
    onSuccess: (response) => {
      addLog('MUTATION_ON_SUCCESS', { status: response.status, hasBata: !!response.data })
      
      // Update mutation state for UI
      setMutationState((prev) => ({
        ...prev,
        isPending: false,
        isSuccess: true,
        data: response.data,
      }))

      // Test 4: Verify queryClient invalidation
      try {
        const result = queryClient.invalidateQueries({ queryKey: ['lmsBookTree', testBookId] })
        addLog('MUTATION_CACHE_INVALIDATED', { result: !!result })
      } catch (err) {
        addLog('MUTATION_CACHE_INVALIDATION_ERROR', { message: err.message })
      }

      addLog('MUTATION_COMPLETE_SUCCESS', {})
    },
    onError: (error) => {
      addLog('MUTATION_ON_ERROR', {
        status: error.response?.status,
        detail: error.response?.data?.detail,
        message: error.message,
      })

      setMutationState((prev) => ({
        ...prev,
        isPending: false,
        isError: true,
        error: error.message,
      }))

      addLog('MUTATION_COMPLETE_ERROR', {})
    },
    onSettled: () => {
      addLog('MUTATION_SETTLED', {})
    },
  })

  // ============ TEST BUTTON: Direct Mutation Call ============
  const handleDirectMutationTest = async () => {
    if (!testBookId.trim()) {
      addLog('VALIDATION_FAILED', { reason: 'Book ID is empty' })
      return
    }

    setExecutionLog([])
    logRef.current = []
    setMutationState({
      isPending: true,
      isError: false,
      isSuccess: false,
      error: null,
      data: null,
    })

    addLog('TEST_START', { bookId: testBookId })

    const testData = {
      chapters: [
        {
          title: 'Test Chapter 1',
          topics: [
            { title: 'Test Topic 1.1' },
            { title: 'Test Topic 1.2' },
          ],
        },
        {
          title: 'Test Chapter 2',
          topics: [
            { title: 'Test Topic 2.1' },
          ],
        },
      ],
      idempotency_key: `test-${Date.now()}`,
    }

    addLog('PAYLOAD_PREPARED', {
      chapters: testData.chapters.length,
      totalTopics: testData.chapters.reduce((sum, ch) => sum + ch.topics.length, 0),
    })

    // Store for display
    setTestPayload(testData)

    // Execute mutation
    addLog('CALLING_MUTATION', {})
    diagnosticMutation.mutate({ id: testBookId, data: testData })
  }

  // ============ UI: Display Execution Trace ============
  return (
    <div className="w-full max-w-4xl mx-auto p-4 bg-white border rounded-lg shadow">
      <h2 className="text-lg font-bold mb-4">Apply TOC Mutation Diagnostics</h2>

      {/* Input Section */}
      <div className="space-y-3 mb-6 p-3 bg-gray-50 rounded border">
        <label className="block text-sm font-semibold">
          Test Book ID:
          <input
            type="text"
            value={testBookId}
            onChange={(e) => setTestBookId(e.target.value)}
            placeholder="e.g., 123"
            className="ml-2 px-2 py-1 border rounded w-32"
          />
        </label>
        <button
          onClick={handleDirectMutationTest}
          disabled={!testBookId.trim() || mutationState.isPending}
          className="btn btn-primary"
        >
          {mutationState.isPending ? 'Running...' : 'Run Direct Mutation Test'}
        </button>
      </div>

      {/* Mutation State Display */}
      <div className="mb-6 p-3 bg-blue-50 border border-blue-200 rounded">
        <h3 className="font-semibold mb-2">Mutation State:</h3>
        <table className="text-sm w-full">
          <tbody>
            <tr>
              <td className="font-mono text-gray-600">isPending</td>
              <td className={mutationState.isPending ? 'text-orange-600 font-bold' : 'text-gray-600'}>
                {String(mutationState.isPending)}
              </td>
            </tr>
            <tr>
              <td className="font-mono text-gray-600">isSuccess</td>
              <td className={mutationState.isSuccess ? 'text-green-600 font-bold' : 'text-gray-600'}>
                {String(mutationState.isSuccess)}
              </td>
            </tr>
            <tr>
              <td className="font-mono text-gray-600">isError</td>
              <td className={mutationState.isError ? 'text-red-600 font-bold' : 'text-gray-600'}>
                {String(mutationState.isError)}
              </td>
            </tr>
            {mutationState.error && (
              <tr>
                <td className="font-mono text-gray-600">error</td>
                <td className="text-red-600">{mutationState.error}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Execution Log */}
      <div className="mb-6">
        <h3 className="font-semibold mb-2">Execution Log ({executionLog.length} events):</h3>
        <div className="bg-gray-900 text-gray-100 p-3 rounded font-mono text-xs overflow-auto max-h-96 space-y-1">
          {executionLog.length === 0 ? (
            <div className="text-gray-500">No logs yet. Click "Run Direct Mutation Test" to start.</div>
          ) : (
            executionLog.map((entry, idx) => (
              <div key={idx} className="border-b border-gray-700 pb-1">
                <span className="text-cyan-400">{entry.timestamp}</span>
                {' '}
                <span className="text-yellow-400">[{entry.step}]</span>
                {Object.entries(entry)
                  .filter(([k]) => !['timestamp', 'step'].includes(k))
                  .map(([k, v]) => (
                    <span key={k} className="ml-2">
                      <span className="text-green-400">{k}:</span>
                      <span className="text-white">{JSON.stringify(v)}</span>
                    </span>
                  ))}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Test Payload Display */}
      {testPayload && (
        <div className="p-3 bg-gray-50 border rounded">
          <h3 className="font-semibold mb-2">Test Payload Sent:</h3>
          <pre className="text-xs bg-white p-2 border rounded overflow-auto max-h-40">
            {JSON.stringify(testPayload, null, 2)}
          </pre>
        </div>
      )}

      {/* Instructions */}
      <div className="mt-6 p-3 bg-yellow-50 border border-yellow-200 rounded text-sm">
        <h3 className="font-semibold mb-2">How to use:</h3>
        <ol className="list-decimal list-inside space-y-1">
          <li>Enter a real book ID from your database</li>
          <li>Click "Run Direct Mutation Test"</li>
          <li>Watch the execution log for the flow</li>
          <li>Check browser DevTools Network tab simultaneously</li>
          <li>Look for POST request to <code>/api/lms/books/[ID]/apply_toc/</code></li>
          <li>If no network request appears, mutation.mutate() is blocked</li>
          <li>If network request appears but backend doesn't log it, check server logs</li>
        </ol>
      </div>
    </div>
  )
}

export default ApplyTocDiagnostics
