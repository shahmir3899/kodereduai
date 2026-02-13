import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import html2canvas from 'html2canvas'

/**
 * Export filtered students list as PDF (grouped by class)
 */
export function exportStudentsPDF({ students, schoolName, filterInfo }) {
  if (!students.length) return

  const doc = new jsPDF()

  // Title
  doc.setFontSize(16)
  doc.text('Students List', 14, 20)
  if (schoolName) {
    doc.setFontSize(10)
    doc.text(schoolName, 14, 28)
  }

  // Summary line
  let startY = schoolName ? 34 : 28
  doc.setFontSize(9)
  doc.text(`Total: ${students.length} students`, 14, startY)
  if (filterInfo) {
    doc.text(filterInfo, 80, startY)
  }
  startY += 8

  // Group by class
  const grouped = {}
  students.forEach(s => {
    const cls = s.class_name || 'Unknown'
    if (!grouped[cls]) grouped[cls] = []
    grouped[cls].push(s)
  })

  Object.entries(grouped).forEach(([className, records]) => {
    records.sort((a, b) => (parseInt(a.roll_number) || 0) - (parseInt(b.roll_number) || 0))

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
      head: [['Roll#', 'Student Name', 'Parent Name', 'Parent Phone', 'Status']],
      body: records.map((s) => [
        s.roll_number || '',
        s.name || '',
        s.parent_name || '',
        s.parent_phone || '',
        s.is_active ? 'Active' : 'Inactive',
      ]),
      theme: 'grid',
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [79, 70, 229], fontSize: 8 },
      columnStyles: {
        0: { cellWidth: 15 },
      },
    })

    startY = doc.lastAutoTable.finalY + 10
  })

  doc.save('Students_List.pdf')
}

/**
 * Export filtered students list as PNG (renders off-screen table, captures with html2canvas)
 */
export async function exportStudentsPNG({ students, schoolName, filterInfo }) {
  if (!students.length) return

  const container = document.createElement('div')
  container.style.position = 'absolute'
  container.style.left = '-9999px'
  container.style.top = '0'
  container.style.background = 'white'
  container.style.padding = '24px'
  container.style.fontFamily = 'system-ui, -apple-system, sans-serif'
  container.style.width = '800px'

  // Group by class
  const grouped = {}
  students.forEach(s => {
    const cls = s.class_name || 'Unknown'
    if (!grouped[cls]) grouped[cls] = []
    grouped[cls].push(s)
  })

  let html = `
    <h2 style="margin: 0 0 4px; font-size: 20px; color: #111;">Students List</h2>
    ${schoolName ? `<p style="margin: 0 0 4px; font-size: 13px; color: #666;">${schoolName}</p>` : ''}
    <p style="margin: 0 0 16px; font-size: 12px; color: #888;">${students.length} students${filterInfo ? ' &middot; ' + filterInfo : ''}</p>
  `

  Object.entries(grouped).forEach(([className, records]) => {
    records.sort((a, b) => (parseInt(a.roll_number) || 0) - (parseInt(b.roll_number) || 0))

    html += `<h3 style="margin: 16px 0 6px; font-size: 14px; color: #333;">${className}</h3>`
    html += `<table style="width: 100%; border-collapse: collapse; margin-bottom: 12px; font-size: 12px;">`
    html += `<thead><tr style="background: #4f46e5; color: white;">
      <th style="padding: 6px 8px; text-align: left;">Roll#</th>
      <th style="padding: 6px 8px; text-align: left;">Student Name</th>
      <th style="padding: 6px 8px; text-align: left;">Parent Name</th>
      <th style="padding: 6px 8px; text-align: left;">Parent Phone</th>
      <th style="padding: 6px 8px; text-align: left;">Status</th>
    </tr></thead><tbody>`

    records.forEach((s, i) => {
      const bg = i % 2 === 0 ? '#fff' : '#f9fafb'
      html += `<tr style="background: ${bg}; border-bottom: 1px solid #e5e7eb;">
        <td style="padding: 5px 8px;">${s.roll_number || ''}</td>
        <td style="padding: 5px 8px;">${s.name || ''}</td>
        <td style="padding: 5px 8px;">${s.parent_name || ''}</td>
        <td style="padding: 5px 8px;">${s.parent_phone || ''}</td>
        <td style="padding: 5px 8px;">${s.is_active ? 'Active' : 'Inactive'}</td>
      </tr>`
    })

    html += `</tbody></table>`
  })

  container.innerHTML = html
  document.body.appendChild(container)

  try {
    const canvas = await html2canvas(container, {
      scale: 2,
      backgroundColor: '#ffffff',
    })

    const link = document.createElement('a')
    link.download = 'Students_List.png'
    link.href = canvas.toDataURL('image/png')
    link.click()
  } finally {
    document.body.removeChild(container)
  }
}
