import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import GroupPhotoOverlay, { getDetectionTone } from '../GroupPhotoOverlay'

const det = (over) => ({
  id: 1,
  face_index: 0,
  bounding_box: { top: 100, left: 100, right: 200, bottom: 220 },
  match_status: 'AUTO_MATCHED',
  matched_student: { id: 9, name: 'Ali Hassan' },
  confidence: 91.4,
  alternative_matches: [],
  ...over,
})

// jsdom never loads images, so give the <img> a size and fire its load event.
function loadImage(natural = { width: 1000, height: 800 }) {
  const img = screen.getByAltText('Captured')
  Object.defineProperty(img, 'naturalWidth', { value: natural.width })
  Object.defineProperty(img, 'naturalHeight', { value: natural.height })
  fireEvent.load(img)
}

describe('GroupPhotoOverlay', () => {
  it('shows every face labelled with number, name and confidence — no hover needed', () => {
    render(
      <GroupPhotoOverlay
        imageUrl="/g.jpg"
        detections={[
          det(),
          det({ id: 2, face_index: 1, matched_student: null, match_status: 'IGNORED', confidence: 0,
            bounding_box: { top: 300, left: 400, right: 500, bottom: 420 } }),
        ]}
      />
    )
    loadImage()

    expect(screen.getByTestId('face-box-1')).toHaveTextContent('1')
    expect(screen.getByTestId('face-box-1')).toHaveTextContent('Ali Hassan · 91%')
    expect(screen.getByTestId('face-box-2')).toHaveTextContent('Unknown')
  })

  it('ticks faces whose student is marked present, and not the others', () => {
    render(
      <GroupPhotoOverlay
        imageUrl="/g.jpg"
        presentIds={new Set([9])}
        detections={[
          det(),
          det({ id: 2, face_index: 1, matched_student: { id: 12, name: 'Sara Khan' },
            bounding_box: { top: 300, left: 400, right: 500, bottom: 420 } }),
        ]}
      />
    )
    loadImage()

    expect(screen.getByTestId('face-box-1').querySelector('[aria-label="marked present"]')).not.toBeNull()
    expect(screen.getByTestId('face-box-2').querySelector('[aria-label="marked present"]')).toBeNull()
  })

  it('uses the operator\'s override instead of the original match', () => {
    render(
      <GroupPhotoOverlay
        imageUrl="/g.jpg"
        presentIds={new Set([12])}
        overrideMatches={{ 1: { id: 12, name: 'Sara Khan', confidence: 55 } }}
        detections={[det()]}
      />
    )
    loadImage()

    const box = screen.getByTestId('face-box-1')
    expect(box).toHaveTextContent('Sara Khan · 55%')
    expect(box).not.toHaveTextContent('Ali Hassan')
    expect(box.querySelector('[aria-label="marked present"]')).not.toBeNull()
  })

  it('can switch to numbers only for crowded photos', async () => {
    const user = userEvent.setup()
    render(<GroupPhotoOverlay imageUrl="/g.jpg" detections={[det()]} />)
    loadImage()

    await user.click(screen.getByText('Show numbers only'))
    expect(screen.getByTestId('face-box-1')).not.toHaveTextContent('Ali Hassan')
    expect(screen.getByTestId('face-box-1')).toHaveTextContent('91%')
    await user.click(screen.getByText('Show names'))
    expect(screen.getByTestId('face-box-1')).toHaveTextContent('Ali Hassan')
  })

  it('opens the other-candidates picker on tap and reports the pick', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    const onPick = vi.fn()
    const alternative = { student_id: 12, name: 'Sara Khan', confidence: 40 }
    const flagged = det({ match_status: 'FLAGGED', alternative_matches: [alternative] })

    const { rerender } = render(
      <GroupPhotoOverlay imageUrl="/g.jpg" detections={[flagged]} onSelect={onSelect} onPickAlternative={onPick} />
    )
    loadImage()
    await user.click(screen.getByTestId('face-box-1'))
    expect(onSelect).toHaveBeenCalledWith(1)

    rerender(
      <GroupPhotoOverlay imageUrl="/g.jpg" detections={[flagged]} activeId={1} onSelect={onSelect} onPickAlternative={onPick} />
    )
    await user.click(screen.getByText('Sara Khan'))
    expect(onPick).toHaveBeenCalledWith(flagged, alternative)
  })

  it('is read-only without onPickAlternative (confirmed sessions)', () => {
    const flagged = det({ match_status: 'FLAGGED', alternative_matches: [{ student_id: 12, name: 'Sara Khan', confidence: 40 }] })
    render(<GroupPhotoOverlay imageUrl="/g.jpg" detections={[flagged]} activeId={1} />)
    loadImage()
    expect(screen.queryByText('Other candidates')).not.toBeInTheDocument()
  })
})

describe('getDetectionTone', () => {
  it('colours by outcome, with unknown faces red', () => {
    expect(getDetectionTone(det(), { id: 1 }).border).toBe('border-green-500')
    expect(getDetectionTone(det({ match_status: 'FLAGGED' }), { id: 1 }).border).toBe('border-yellow-500')
    expect(getDetectionTone(det(), null).border).toBe('border-red-500')
    expect(getDetectionTone(det({ match_status: 'IGNORED' }), { id: 1 }).border).toBe('border-gray-400')
  })
})
