import Modal from '../../components/ui/Modal'
import TermsManager from './TermsManager'

/** A year's terms (timeline, list, add/edit with slider) in a dialog. The setup wizard embeds TermsManager inline. */
export default function TermsModal({ year, onClose, onImport }) {
  return (
    <Modal open onClose={onClose} title={`Terms - ${year.name}`} size="3xl">
      <TermsManager year={year} onImport={onImport} />
    </Modal>
  )
}
