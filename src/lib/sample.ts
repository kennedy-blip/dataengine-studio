import type { Row, SourceDataset } from './types';

export function createSampleDatasets(): SourceDataset[] {
  const first = ['Amara', 'James', 'Sofia', 'Liam', 'Aisha', 'Noah', 'Zuri', 'Oliver', 'Maya', 'Ethan', 'Chloe', 'Lucas', 'Isla', 'Leo', 'Nia', 'Felix', 'Ava', 'Oscar', 'Zara', 'Theo'];
  const last = ['Mwangi', 'Chen', 'Patel', 'Williams', 'Okafor', 'Kim', 'Garcia', 'Smith', 'Hassan', 'Brown', 'Davis', 'Wilson'];
  const countries = ['Kenya', 'United States', 'United Kingdom', 'India', 'Canada', 'Germany', 'Nigeria', 'Australia'];
  const plans = ['Starter', 'Growth', 'Business', 'Enterprise'];
  const notes = ['Excellent onboarding experience. The team is very helpful and responsive.', 'Great product, easy to use and reliable for our daily workflow.', 'Waiting for a response to my support request. Not happy with the delay.', 'The new dashboard is good, but billing needs improvement.', 'Outstanding service. Highly recommend this platform to other teams.', 'Setup was difficult and the documentation was confusing.', 'Love the new features. Everything works perfectly.', 'Average experience. Some features are useful, others need work.'];
  const rows: Row[] = Array.from({ length: 1236 }, (_, i) => {
    const fn = first[i % first.length], ln = last[Math.floor(i / first.length) % last.length];
    const plan = plans[(i * 7 + Math.floor(i / 13)) % 4];
    const price = { Starter: 29, Growth: 79, Business: 149, Enterprise: 299 }[plan]!;
    const month = i % 6;
    return {
      customer_id: `CUS-${String(i + 1).padStart(5, '0')}`,
      customer_name: `${fn} ${ln}`,
      email: i % 71 === 0 ? null : `${fn.toLowerCase()}.${ln.toLowerCase()}${i}@example.com`,
      country: countries[(i * 3 + Math.floor(i / 19)) % countries.length],
      signup_date: `2025-${String((i % 12) + 1).padStart(2, '0')}-${String((i % 27) + 1).padStart(2, '0')}`,
      plan,
      monthly_spend: i % 251 === 0 ? null : i % 311 === 0 ? 24999 : price + (i % 5) * 10,
      support_tickets: i % 9,
      satisfaction: i % 17 === 0 ? null : Number((2.5 + (i % 25) / 10).toFixed(1)),
      active: i % 7 !== 0,
      last_purchase: `2026-${String(month + 1).padStart(2, '0')}-${String((i % 27) + 1).padStart(2, '0')}`,
      feedback: i % 11 === 0 ? null : notes[i % notes.length],
    };
  });
  for (let i = 0; i < 12; i++) rows.push({ ...rows[i * 17] });
  const importedAt = new Date().toISOString();
  const orders: Row[] = Array.from({ length: 180 }, (_, i) => ({ order_id: `ORD-${1001 + i}`, customer_id: `CUS-${String((i % 200) + 1).padStart(5, '0')}`, product: ['Analytics Pro', 'Team workspace', 'Data connector', 'Storage add-on'][i % 4], quantity: (i % 4) + 1, amount: [129, 249, 59, 39][i % 4] * ((i % 4) + 1), order_date: `2026-0${(i % 6) + 1}-${String((i % 27) + 1).padStart(2, '0')}`, status: ['Completed', 'Completed', 'Completed', 'Pending'][i % 4] }));
  const regions: Row[] = countries.map((country, i) => ({ country, region: ['East Africa', 'North America', 'Europe', 'South Asia', 'North America', 'Europe', 'West Africa', 'Oceania'][i], account_manager: first[i], target: [25000, 85000, 60000, 40000, 45000, 55000, 30000, 35000][i] }));
  return [
    { id: 'demo-customers', name: 'customers.csv', format: 'csv', rows, sourceBytes: 248_320, importedAt, encoding: 'UTF-8', delimiter: ',', demo: true, note: 'Synthetic customer records. No real personal data.' },
    { id: 'demo-orders', name: 'orders.csv', format: 'csv', rows: orders, sourceBytes: 14_800, importedAt, encoding: 'UTF-8', delimiter: ',', demo: true },
    { id: 'demo-regions', name: 'regions.csv', format: 'csv', rows: regions, sourceBytes: 840, importedAt, encoding: 'UTF-8', delimiter: ',', demo: true },
  ];
}
