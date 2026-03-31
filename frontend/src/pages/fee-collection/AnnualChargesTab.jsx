import AnnualChargesCardView from './AnnualChargesCardView'

/**
 * AnnualChargesTab — Wrapper component that displays the card-based view for all classes.
 *
 * This component delegates to AnnualChargesCardView which shows all classes as cards,
 * allowing schools to configure annual charges for multiple classes at once without
 * needing to switch between class selectors.
 */
export default function AnnualChargesTab() {
  return <AnnualChargesCardView />
}
