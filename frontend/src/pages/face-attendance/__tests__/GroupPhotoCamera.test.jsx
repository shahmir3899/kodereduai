import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import GroupPhotoCamera from '../GroupPhotoCamera'

const mockDetectAllFacesQuick = vi.fn()
vi.mock('../../../utils/faceApiLoader', () => ({
  loadFaceApiModels: vi.fn(() => Promise.resolve()),
  detectAllFacesQuick: (...args) => mockDetectAllFacesQuick(...args),
}))

const stopTrack = vi.fn()
const fakeStream = { getTracks: () => [{ stop: stopTrack }] }
let getUserMedia

function stubVideoAndCanvas() {
  Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', { configurable: true, get: () => 1280 })
  Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', { configurable: true, get: () => 720 })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() })
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb) => cb(new Blob(['jpeg-bytes'], { type: 'image/jpeg' })))
}

beforeEach(() => {
  stopTrack.mockClear()
  mockDetectAllFacesQuick.mockReset().mockResolvedValue([])
  getUserMedia = vi.fn(() => Promise.resolve(fakeStream))
  Object.defineProperty(window.navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } })
})

afterEach(() => {
  vi.restoreAllMocks()
  delete HTMLVideoElement.prototype.videoWidth
  delete HTMLVideoElement.prototype.videoHeight
})

describe('GroupPhotoCamera', () => {
  it('opens the rear camera first, unmirrored (a class photo is of other people)', async () => {
    render(<GroupPhotoCamera onCapture={vi.fn()} onCancel={vi.fn()} />)

    await waitFor(() => expect(getUserMedia).toHaveBeenCalled())
    expect(getUserMedia.mock.calls[0][0]).toEqual({ video: { facingMode: 'environment' } })
    expect(document.querySelector('video').style.transform).toBe('')
  })

  it('shows how many faces are in frame', async () => {
    mockDetectAllFacesQuick.mockResolvedValue([
      { box: { x: 0, y: 0, width: 50, height: 50 } },
      { box: { x: 100, y: 0, width: 50, height: 50 } },
      { box: { x: 200, y: 0, width: 50, height: 50 } },
    ])
    render(<GroupPhotoCamera onCapture={vi.fn()} onCancel={vi.fn()} />)

    await waitFor(() => expect(screen.getByTestId('live-face-count')).toHaveTextContent('3 faces in frame'))
  })

  it('flips to the front camera, which is mirrored like a selfie view', async () => {
    const user = userEvent.setup()
    render(<GroupPhotoCamera onCapture={vi.fn()} onCancel={vi.fn()} />)
    await user.click(await screen.findByText('Use front camera'))

    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2))
    expect(getUserMedia.mock.calls[1][0]).toEqual({ video: { facingMode: 'user' } })
    await waitFor(() => expect(document.querySelector('video').style.transform).toBe('scaleX(-1)'))
    expect(screen.getByText('Use rear camera')).toBeInTheDocument()
  })

  it('captures a JPEG file from the live frame and releases the camera', async () => {
    stubVideoAndCanvas()
    const onCapture = vi.fn()
    const user = userEvent.setup()
    render(<GroupPhotoCamera onCapture={onCapture} onCancel={vi.fn()} />)

    await user.click(await screen.findByText('Capture photo'))

    await waitFor(() => expect(onCapture).toHaveBeenCalledTimes(1))
    const file = onCapture.mock.calls[0][0]
    expect(file).toBeInstanceOf(File)
    expect(file.type).toBe('image/jpeg')
    expect(file.name).toMatch(/^group-photo-.*\.jpg$/)
    expect(stopTrack).toHaveBeenCalled()
  })

  it('cancel releases the camera and reports it', async () => {
    const onCancel = vi.fn()
    const user = userEvent.setup()
    render(<GroupPhotoCamera onCapture={vi.fn()} onCancel={onCancel} />)
    await screen.findByText('Capture photo')

    await user.click(screen.getByText('Cancel'))
    expect(onCancel).toHaveBeenCalled()
    expect(stopTrack).toHaveBeenCalled()
  })

  it('offers a retry when the camera is blocked', async () => {
    getUserMedia.mockRejectedValue(Object.assign(new Error('no'), { name: 'NotAllowedError' }))
    render(<GroupPhotoCamera onCapture={vi.fn()} onCancel={vi.fn()} />)

    expect(await screen.findByText('Retry Camera Access')).toBeInTheDocument()
    expect(screen.queryByText('Capture photo')).not.toBeInTheDocument()
  })
})
