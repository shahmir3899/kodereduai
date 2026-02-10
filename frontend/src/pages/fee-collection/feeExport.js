import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

export function exportFeePDF({ paymentList, month, year, summaryData, schoolName }) {
  const doc = new jsPDF()

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ]

  // Title
  doc.setFontSize(16)
  doc.text(`Fee Collection Report`, 14, 20)
  doc.setFontSize(11)
  doc.text(`${monthNames[month - 1]} ${year}`, 14, 28)
  if (schoolName) {
    doc.setFontSize(10)
    doc.text(schoolName, 14, 34)
  }

  // Summary
  let startY = schoolName ? 42 : 36
  if (summaryData) {
    doc.setFontSize(9)
    doc.text(`Total Due: ${Number(summaryData.total_due || 0).toLocaleString()}`, 14, startY)
    doc.text(`Collected: ${Number(summaryData.total_collected || 0).toLocaleString()}`, 80, startY)
    doc.text(`Pending: ${Number(summaryData.total_pending || 0).toLocaleString()}`, 146, startY)
    startY += 8
  }

  // Group by class
  const grouped = {}
  paymentList.forEach(p => {
    const cls = p.class_name || 'Unknown'
    if (!grouped[cls]) grouped[cls] = []
    grouped[cls].push(p)
  })

  Object.entries(grouped).forEach(([className, records]) => {
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
      head: [['#', 'Student', 'Roll#', 'Due', 'Paid', 'Balance', 'Status']],
      body: records.map((r, i) => [
        i + 1,
        r.student_name,
        r.student_roll || '',
        Number(r.amount_due).toLocaleString(),
        Number(r.amount_paid).toLocaleString(),
        (Number(r.amount_due) - Number(r.amount_paid)).toLocaleString(),
        r.status,
      ]),
      theme: 'grid',
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [79, 70, 229], fontSize: 8 },
      columnStyles: {
        0: { cellWidth: 10 },
        3: { halign: 'right' },
        4: { halign: 'right' },
        5: { halign: 'right' },
      },
    })

    startY = doc.lastAutoTable.finalY + 10
  })

  doc.save(`Fee_Report_${year}_${String(month).padStart(2, '0')}.pdf`)
}
