import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

export function exportFeePDF({ paymentList, month, year, summaryData, schoolName }) {
  const doc = new jsPDF()

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ]

  // Compute stats from actual table data so they always match
  const totalDue = paymentList.reduce((sum, p) => sum + Math.max(0, Number(p.amount_due)), 0)
  const totalCollected = paymentList.reduce((sum, p) => sum + Number(p.amount_paid), 0)
  const totalPending = Math.max(0, totalDue - totalCollected)

  // Title
  doc.setFontSize(16)
  doc.text(`Fee Collection Report`, 14, 20)
  doc.setFontSize(11)
  doc.text(`${monthNames[month - 1]} ${year}`, 14, 28)
  if (schoolName) {
    doc.setFontSize(10)
    doc.text(schoolName, 14, 34)
  }

  // Summary (computed from paymentList)
  let startY = schoolName ? 42 : 36
  doc.setFontSize(9)
  doc.text(`Total Due: ${totalDue.toLocaleString()}`, 14, startY)
  doc.text(`Collected: ${totalCollected.toLocaleString()}`, 80, startY)
  doc.text(`Pending: ${totalPending.toLocaleString()}`, 146, startY)
  startY += 8

  // Group by class
  const grouped = {}
  paymentList.forEach(p => {
    const cls = p.class_name || 'Unknown'
    if (!grouped[cls]) grouped[cls] = []
    grouped[cls].push(p)
  })

  Object.entries(grouped).forEach(([className, records]) => {
    // Sort by numeric roll number within each class
    records.sort((a, b) => (parseInt(a.student_roll) || 0) - (parseInt(b.student_roll) || 0))

    // Check if we need a new page
    if (startY > 260) {
      doc.addPage()
      startY = 20
    }

    doc.setFontSize(11)
    doc.setFont(undefined, 'bold')
    doc.text(className, 14, startY)
    doc.setFont(undefined, 'normal')
    startY += 2

    autoTable(doc, {
      startY,
      head: [['#', 'Roll#', 'Student', 'Prev Bal', 'Monthly Fee', 'Total Due', 'Paid', 'Balance', 'Status']],
      body: records.map((r, i) => {
        const prevBal = Number(r.previous_balance || 0)
        const monthlyFee = Number(r.amount_due) - prevBal
        const totalDueRow = Math.max(0, Number(r.amount_due))
        const balance = Math.max(0, Number(r.amount_due) - Number(r.amount_paid))
        return [
          i + 1,
          r.student_roll || '',
          r.student_name,
          prevBal !== 0 ? prevBal.toLocaleString() : '\u2014',
          monthlyFee.toLocaleString(),
          totalDueRow.toLocaleString(),
          Number(r.amount_paid).toLocaleString(),
          balance.toLocaleString(),
          r.status,
        ]
      }),
      theme: 'grid',
      styles: { fontSize: 7, cellPadding: 1.5 },
      headStyles: { fillColor: [79, 70, 229], fontSize: 7 },
      columnStyles: {
        0: { cellWidth: 8 },
        1: { cellWidth: 12 },
        3: { halign: 'right' },
        4: { halign: 'right' },
        5: { halign: 'right' },
        6: { halign: 'right' },
        7: { halign: 'right' },
      },
    })

    startY = doc.lastAutoTable.finalY + 10
  })

  doc.save(`Fee_Report_${year}_${String(month).padStart(2, '0')}.pdf`)
}
