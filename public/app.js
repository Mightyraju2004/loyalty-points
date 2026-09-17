let activeMember = null;
let currentPage = 1;

function checkAuth() {
  // Add authentication checks if needed
}

function logout() {
  window.location.href = '/index.html';
}

async function registerMember(event) {
  event.preventDefault();
  const name = document.getElementById('mName').value;
  const phone = document.getElementById('mPhone').value;
  const email = document.getElementById('mEmail').value;

  try {
    const res = await fetch('/api/members', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, phone, email })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    alert(`Member registered! Name: ${data.name}, Tier: ${data.tier}`);
    document.getElementById('addMemberForm').reset();
    loadMembers(1);
  } catch (err) {
    alert(err.message);
  }
}

async function lookupMember() {
  const phone = document.getElementById('lookupPhone').value;
  if (!phone) return alert('Please enter a phone number.');

  try {
    const res = await fetch(`/api/members/lookup?phone=${encodeURIComponent(phone)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    activeMember = data;
    document.getElementById('activeName').textContent = data.name;
    document.getElementById('activePhone').textContent = data.phone;
    document.getElementById('activeBalance').textContent = `${data.points} pts`;
    const tierEl = document.getElementById('activeTier');
    tierEl.textContent = data.tier;
    tierEl.className = `badge ${data.tier}`;
    document.getElementById('activeMemberCard').style.display = 'block';
  } catch (err) {
    alert(err.message);
    document.getElementById('activeMemberCard').style.display = 'none';
    activeMember = null;
  }
}

async function processEarn() {
  if (!activeMember) return alert('Please lookup a member first!');
  const amount = document.getElementById('purchaseAmount').value;

  try {
    const res = await fetch('/api/transactions/earn', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: activeMember.phone, billAmount: amount })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    alert(data.message);
    document.getElementById('purchaseAmount').value = '';
    await lookupMember();
    loadMembers(currentPage);
  } catch (err) {
    alert(err.message);
  }
}

async function processRedeem() {
  if (!activeMember) return alert('Please lookup a member first!');
  const rewardSelect = document.getElementById('rewardSelect');
  const cost = parseInt(rewardSelect.value, 10);

  try {
    const res = await fetch('/api/transactions/redeem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: activeMember.phone, cost })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    alert(data.message);
    await lookupMember();
    loadMembers(currentPage);
  } catch (err) {
    alert(err.message);
  }
}

async function loadMembers(page = 1) {
  currentPage = page;
  const search = document.getElementById('searchInput')?.value || '';

  try {
    const res = await fetch(`/api/members?page=${page}&search=${encodeURIComponent(search)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    const tbody = document.getElementById('memberTableBody');
    if (!tbody) return;

    tbody.innerHTML = data.members.map(m => `
      <tr style="border-bottom: 1px solid #f1f5f9;">
        <td>#${m.id}</td>
        <td><strong>${m.name}</strong></td>
        <td>${m.phone}</td>
        <td>${m.points} pts</td>
        <td><span class="badge ${m.tier}"><strong>${m.tier}</strong></span></td>
        <td>${m.displayMultiplier}</td>
      </tr>
    `).join('');

    const pageInfo = document.getElementById('pageInfo');
    if (pageInfo) pageInfo.textContent = `Page ${data.page} of ${data.totalPages}`;
  } catch (err) {
    console.error('Failed to load members:', err);
  }
}