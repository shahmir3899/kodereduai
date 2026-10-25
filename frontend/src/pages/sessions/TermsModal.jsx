import Modal from '../../components/ui/Modal'
import Badge from '../../components/ui/Badge'
import { yearBadges } from '../../components/academic/academicTones'
import TermsManager from './TermsManager'

/** A year's terms (timeline, list, add/edit with slider) in a dialog. The setup wizard embeds TermsManager inline. */
export default function TermsModal({ year, onClose, onImport }) {
  return (
    <Modal open onClose={onClose} title={`Terms - ${year.name}`} size="3xl">
      <div className="-mt-2 mb-3 flex flex-wrap gap-1">
        {yearBadges(year, null).map((b) => <Badge key={b.key} tone={b.tone}>{b.label}</Badge>)}
      </div>
      <TermsManager year={year} onImport={onImport} />
    </Modal>
  )
}
