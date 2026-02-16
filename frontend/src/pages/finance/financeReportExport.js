import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const PRIMARY_COLOR = [79, 70, 229]
const MARGIN = { left: 14, right: 14 }

export function exportFinanceReport({
  schoolName,
  periodLabel,
  dateFrom,
  dateTo,
  summary,
  trendData,
  categories,
  catTotal,
  accounts,
  grandTotal,
  feeCollectionRate,
  feeTotalCollected,
  feeTotalPending,
}) {
  const doc = new jsPDF()
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const tableWidth = pageWidth - MARGIN.left - MARGIN.right
  const now = new Date()
  const generatedDate = now.toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })

  const baseStyles = {
    fontSize: 9,
    cellPadding: { top: 3, right: 4, bottom: 3, left: 4 },
    overflow: 'linebreak',
  }
  const baseHeadStyles = {
    fillColor: PRIMARY_COLOR,
    fontSize: 9,
    fontStyle: 'bold',
    cellPadding: { top: 3, right: 4, bottom: 3, left: 4 },
  }

  // Helper: create header cell with alignment
  const hCell = (text, halign = 'left') => ({ content: text, styles: { halign } })

  // --- HEADER ---
  doc.setFontSize(20)
  doc.setFont(undefined, 'bold')
  doc.setTextColor(...PRIMARY_COLOR)
  doc.text('Finance Report', MARGIN.left, 22)
  doc.setTextColor(0)

  doc.setFontSize(11)
  doc.setFont(undefined, 'normal')
  if (schoolName) {
    doc.text(schoolName, MARGIN.left, 30)
  }
  doc.setFontSize(9)
  doc.setTextColor(100)
  doc.text(`Period: ${periodLabel} (${dateFrom} to ${dateTo})`, MARGIN.left, 37)
  doc.text(`Generated: ${generatedDate}`, MARGIN.left, 43)
  doc.setTextColor(0)

  // Decorative line
  doc.setDrawColor(...PRIMARY_COLOR)
  doc.setLineWidth(0.8)
  doc.line(MARGIN.left, 47, pageWidth - MARGIN.right, 47)

  let startY = 55

  // --- SECTION 1: Financial Summary ---
  doc.setFontSize(13)
  doc.setFont(undefined, 'bold')
  doc.text('Financial Summary', MARGIN.left, startY)
  startY += 4

  autoTable(doc, {
    startY,
    margin: MARGIN,
    tableWidth,
    head: [[hCell('Metric'), hCell('Amount', 'right')]],
    body: [
      ['Total Income', Number(summary.total_income || 0).toLocaleString()],
      ['Total Expenses', Number(summary.total_expenses || 0).toLocaleString()],
      ['Net Balance', Number(summary.balance || 0).toLocaleString()],
      ['Fee Collection Rate', `${feeCollectionRate}%`],
      ['Fee Collected (Current Month)', Number(feeTotalCollected || 0).toLocaleString()],
      ['Fee Pending (Current Month)', Number(feeTotalPending || 0).toLocaleString()],
    ],
    theme: 'striped',
    styles: baseStyles,
    headStyles: baseHeadStyles,
    columnStyles: {
      0: { cellWidth: tableWidth * 0.6 },
      1: { cellWidth: tableWidth * 0.4, halign: 'right', fontStyle: 'bold' },
    },
  })
  startY = doc.lastAutoTable.finalY + 14

  // --- SECTION 2: Account Balances ---
  if (accounts && accounts.length > 0) {
    if (startY > 230) { doc.addPage(); startY = 20 }
    doc.setFontSize(13)
    doc.setFont(undefined, 'bold')
    doc.text('Account Balances', MARGIN.left, startY)
    startY += 4

    const accountRows = accounts.map(a => [
      a.name,
      a.account_type,
      Number(a.net_balance).toLocaleString(),
    ])
    accountRows.push([
      { content: 'Total', styles: { fontStyle: 'bold' } },
      '',
      { content: Number(grandTotal).toLocaleString(), styles: { fontStyle: 'bold' } },
    ])

    autoTable(doc, {
      startY,
      margin: MARGIN,
      tableWidth,
      head: [[hCell('Account'), hCell('Type'), hCell('Balance', 'right')]],
      body: accountRows,
      theme: 'striped',
      styles: baseStyles,
      headStyles: baseHeadStyles,
      columnStyles: {
        0: { cellWidth: tableWidth * 0.45 },
        1: { cellWidth: tableWidth * 0.25 },
        2: { cellWidth: tableWidth * 0.3, halign: 'right' },
      },
    })
    startY = doc.lastAutoTable.finalY + 14
  }

  // --- SECTION 3: Monthly Trend ---
  if (trendData && trendData.length > 0) {
    if (startY > 220) { doc.addPage(); startY = 20 }
    doc.setFontSize(13)
    doc.setFont(undefined, 'bold')
    doc.text('Monthly Trend (Last 6 Months)', MARGIN.left, startY)
    startY += 4

    autoTable(doc, {
      startY,
      margin: MARGIN,
      tableWidth,
      head: [[hCell('Month'), hCell('Income', 'right'), hCell('Expenses', 'right'), hCell('Net Balance', 'right')]],
      body: trendData.map(t => [
        `${MONTH_NAMES[t.month - 1]} ${t.year}`,
        Number(t.income || 0).toLocaleString(),
        Number(t.expenses || 0).toLocaleString(),
        Number(t.balance || 0).toLocaleString(),
      ]),
      theme: 'striped',
      styles: baseStyles,
      headStyles: baseHeadStyles,
      columnStyles: {
        0: { cellWidth: tableWidth * 0.28 },
        1: { cellWidth: tableWidth * 0.24, halign: 'right' },
        2: { cellWidth: tableWidth * 0.24, halign: 'right' },
        3: { cellWidth: tableWidth * 0.24, halign: 'right' },
      },
    })
    startY = doc.lastAutoTable.finalY + 14
  }

  // --- SECTION 4: Expense Breakdown ---
  if (categories && categories.length > 0) {
    if (startY > 220) { doc.addPage(); startY = 20 }
    doc.setFontSize(13)
    doc.setFont(undefined, 'bold')
    doc.text('Expense Breakdown', MARGIN.left, startY)
    startY += 4

    const catRows = categories.map(c => [
      c.category_display,
      Number(c.total_amount).toLocaleString(),
      catTotal > 0 ? `${Math.round(c.total_amount / catTotal * 100)}%` : '0%',
      c.count,
    ])
    catRows.push([
      { content: 'Total', styles: { fontStyle: 'bold' } },
      { content: Number(catTotal).toLocaleString(), styles: { fontStyle: 'bold' } },
      { content: '100%', styles: { fontStyle: 'bold' } },
      '',
    ])

    autoTable(doc, {
      startY,
      margin: MARGIN,
      tableWidth,
      head: [[hCell('Category'), hCell('Amount', 'right'), hCell('% of Total', 'right'), hCell('Entries', 'center')]],
      body: catRows,
      theme: 'striped',
      styles: baseStyles,
      headStyles: baseHeadStyles,
      columnStyles: {
        0: { cellWidth: tableWidth * 0.35 },
        1: { cellWidth: tableWidth * 0.25, halign: 'right' },
        2: { cellWidth: tableWidth * 0.22, halign: 'right' },
        3: { cellWidth: tableWidth * 0.18, halign: 'center' },
      },
    })
  }

  // --- FOOTER on each page ---
  const pageCount = doc.internal.getNumberOfPages()
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i)
    doc.setFontSize(8)
    doc.setTextColor(150)
    doc.text('KoderEduAI Finance Report', MARGIN.left, pageHeight - 10)
    doc.text(`Page ${i} of ${pageCount}`, pageWidth - 35, pageHeight - 10)
    doc.setTextColor(0)
  }

  // Save
  const safeName = (schoolName || 'School').replace(/[^a-zA-Z0-9]/g, '_')
  doc.save(`Finance_Report_${safeName}_${dateFrom}_to_${dateTo}.pdf`)
}
