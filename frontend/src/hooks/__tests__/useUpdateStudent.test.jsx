import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useUpdateStudent } from '../useUpdateStudent'
import { studentsApi } from '../../services/api'

vi.mock('../../services/api', () => ({
  studentsApi: { updateStudent: vi.fn() },
}))

const ali = { id: 5, name: 'Ali', roll_number: '4', class_name: 'Class 1A', blood_group: '' }
const sara = { id: 6, name: 'Sara', roll_number: '5', class_name: 'Class 1A' }

let queryClient

function setup(options) {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } })
  // Seed the caches the way the pages do: detail per year, plain-array and paginated lists.
  queryClient.setQueryData(['student', '5', 1], { data: ali })
  queryClient.setQueryData(['students', 1, 1], { data: [ali, sara] })
  queryClient.setQueryData(['students', 1, 2], { data: { count: 2, results: [ali, sara] } })
  queryClient.setQueryData(['student', '6', 1], { data: sara })
  // The seeded queries have no observers, so the refetch after settling must not run.
  queryClient.setQueryDefaults(['student'], { enabled: false })
  queryClient.setQueryDefaults(['students'], { enabled: false })
  const wrapper = ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  return renderHook(() => useUpdateStudent(options), { wrapper })
}

const cached = (key) => queryClient.getQueryData(key)

describe('useUpdateStudent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('patches the student detail and every cached list the moment the save starts', async () => {
    let finish
    studentsApi.updateStudent.mockReturnValue(new Promise((resolve) => { finish = resolve }))
    const { result } = setup()

    act(() => {
      result.current.mutate({ id: 5, payload: { name: 'Ali H.', blood_group: 'O+' } })
    })

    await waitFor(() => expect(cached(['student', '5', 1]).data.name).toBe('Ali H.'))
    expect(cached(['student', '5', 1]).data.blood_group).toBe('O+')
    expect(cached(['students', 1, 1]).data[0]).toMatchObject({ id: 5, name: 'Ali H.' })
    expect(cached(['students', 1, 2]).data.results[0]).toMatchObject({ id: 5, name: 'Ali H.' })
    expect(cached(['students', 1, 2]).data.count).toBe(2)

    await act(async () => { finish({ data: {} }) })
  })

  it('leaves other students and untouched fields alone', async () => {
    studentsApi.updateStudent.mockResolvedValue({ data: {} })
    const { result } = setup()

    await act(async () => {
      await result.current.mutateAsync({ id: 5, payload: { name: 'Ali H.' } })
    })

    expect(cached(['students', 1, 1]).data[1]).toEqual(sara)
    expect(cached(['student', '6', 1]).data).toEqual(sara)
    expect(cached(['student', '5', 1]).data).toMatchObject({ roll_number: '4', class_name: 'Class 1A' })
  })

  it('sends the id and payload to the API', async () => {
    studentsApi.updateStudent.mockResolvedValue({ data: {} })
    const { result } = setup()

    await act(async () => {
      await result.current.mutateAsync({ id: 5, payload: { name: 'X' } })
    })

    expect(studentsApi.updateStudent).toHaveBeenCalledWith(5, { name: 'X' })
  })

  it('rolls every cache back to what it was when the server rejects the save', async () => {
    studentsApi.updateStudent.mockRejectedValue({ response: { status: 400, data: { name: ['Bad'] } } })
    const { result } = setup()

    await act(async () => {
      await result.current.mutateAsync({ id: 5, payload: { name: 'Nope' } }).catch(() => {})
    })

    expect(cached(['student', '5', 1]).data).toEqual(ali)
    expect(cached(['students', 1, 1]).data).toEqual([ali, sara])
    expect(cached(['students', 1, 2]).data.results).toEqual([ali, sara])
  })

  it('still rejects so the form can show the error beside the field', async () => {
    const error = { response: { status: 400, data: { name: ['Bad'] } } }
    studentsApi.updateStudent.mockRejectedValue(error)
    const { result } = setup()

    await expect(result.current.mutateAsync({ id: 5, payload: { name: 'Nope' } })).rejects.toBe(error)
  })

  it('refetches the detail, summary and lists once the save settles, success or not', async () => {
    studentsApi.updateStudent.mockResolvedValue({ data: {} })
    const { result } = setup()
    const spy = vi.spyOn(queryClient, 'invalidateQueries')

    await act(async () => {
      await result.current.mutateAsync({ id: 5, payload: { name: 'X' } })
    })

    const keys = spy.mock.calls.map(([arg]) => arg.queryKey)
    expect(keys).toEqual(expect.arrayContaining([['student', '5'], ['studentProfileSummary', '5'], ['students']]))

    spy.mockClear()
    studentsApi.updateStudent.mockRejectedValue({ response: { status: 500 } })
    await act(async () => {
      await result.current.mutateAsync({ id: 5, payload: { name: 'Y' } }).catch(() => {})
    })
    expect(spy).toHaveBeenCalledTimes(3)
  })

  it('calls onSuccess with the response after a good save', async () => {
    const onSuccess = vi.fn()
    studentsApi.updateStudent.mockResolvedValue({ data: { id: 5 } })
    const { result } = setup({ onSuccess })

    await act(async () => {
      await result.current.mutateAsync({ id: 5, payload: { name: 'X' } })
    })

    expect(onSuccess).toHaveBeenCalledWith({ data: { id: 5 } }, { id: 5, payload: { name: 'X' } })
  })

  it('does not call onSuccess after a failed save', async () => {
    const onSuccess = vi.fn()
    studentsApi.updateStudent.mockRejectedValue(new Error('boom'))
    const { result } = setup({ onSuccess })

    await act(async () => {
      await result.current.mutateAsync({ id: 5, payload: { name: 'X' } }).catch(() => {})
    })

    expect(onSuccess).not.toHaveBeenCalled()
  })

  it('ignores cached entries that are not student payloads', async () => {
    studentsApi.updateStudent.mockResolvedValue({ data: {} })
    const { result } = setup()
    queryClient.setQueryData(['students', 'summary'], { data: { total: 10 } })
    queryClient.setQueryData(['students', 'empty'], undefined)

    await act(async () => {
      await result.current.mutateAsync({ id: 5, payload: { name: 'X' } })
    })

    expect(cached(['students', 'summary'])).toEqual({ data: { total: 10 } })
  })
})
