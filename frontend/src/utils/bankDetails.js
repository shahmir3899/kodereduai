// "••••8901" from an account number, so a list shows which account without printing the whole number.
export function maskAccountNumber(number) {
  const digits = String(number || '').replace(/[^A-Za-z0-9]/g, '')
  if (!digits) return ''
  return `••••${digits.slice(-4)}`
}

// "HBL ••••8901" for an account row; either part may be missing (the server hides the number from
// roles that don't run the books), and an account without bank details gives ''.
export function bankSummary(account) {
  return [account?.bank_name, maskAccountNumber(account?.account_number)].filter(Boolean).join(' ')
}
