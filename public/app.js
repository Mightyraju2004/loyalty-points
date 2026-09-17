// Check Authentication on Protected Pages
function checkAuth() {
  const token = localStorage.getItem("token");
  if (!token && !window.location.pathname.includes("login") && !window.location.pathname.includes("register") && !window.location.pathname.includes("index.html") && window.location.pathname !== "/") {
    window.location.href = "/login.html";
  }
}

// Global Active Member state for Counter Actions
let activeMember = null;
let currentPage = 1;

// Auth Functions
async function handleLogin(e) {
  e.preventDefault();
  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;
  const errorEl = document.getElementById("authError");

  try {
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Login failed");

    localStorage.setItem("token", data.token);
    localStorage.setItem("user", JSON.stringify(data.user));
    window.location.href = "/dashboard.html";
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.style.display = "block";
  }
}

async function handleRegister(e) {
  e.preventDefault();
  const name = document.getElementById("name").value;
  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;
  const errorEl = document.getElementById("authError");

  try {
    const res = await fetch("/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Registration failed");

    alert("Account created successfully! Please login.");
    window.location.href = "/login.html";
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.style.display = "block";
  }
}

function logout() {
  localStorage.removeItem("token");
  localStorage.removeItem("user");
  window.location.href = "/login.html";
}

// Dashboard POS Logic
async function registerMember(e) {
  e.preventDefault();
  const name = document.getElementById("mName").value;
  const phone = document.getElementById("mPhone").value;
  const email = document.getElementById("mEmail").value;

  try {
    const res = await fetch("/api/members", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, phone, email })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    alert(`Member registered successfully! ID: ${data.id}`);
    document.getElementById("addMemberForm").reset();
    loadMembers();
  } catch (err) {
    alert(err.message);
  }
}

async function lookupMember() {
  const query = document.getElementById("lookupPhone").value.trim();
  if (!query) return alert("Please enter a phone number to search.");

  try {
    const res = await fetch(`/api/members?search=${encodeURIComponent(query)}`);
    const data = await res.json();

    if (data.data.length === 0) {
      alert("No member found with that phone number.");
      activeMember = null;
      document.getElementById("activeMemberCard").style.display = "none";
      return;
    }

    activeMember = data.data[0];
    document.getElementById("activeName").textContent = activeMember.name;
    document.getElementById("activePhone").textContent = activeMember.phone;
    document.getElementById("activeBalance").textContent = `${activeMember.balance} pts`;
    document.getElementById("activeTier").textContent = activeMember.tier;
    document.getElementById("activeTier").className = `badge ${activeMember.tier}`;
    document.getElementById("activeMemberCard").style.display = "block";
  } catch (err) {
    alert("Error searching member.");
  }
}

async function processEarn() {
  if (!activeMember) return alert("Please lookup a member first!");
  const amount = document.getElementById("purchaseAmount").value;
  if (!amount || amount <= 0) return alert("Please enter a valid amount.");

  try {
    const res = await fetch(`/api/members/${activeMember.id}/earn`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    alert(`Success! Earned ${data.transactionPoints} points.`);
    document.getElementById("purchaseAmount").value = "";
    lookupMember(); // Refresh balance
    loadMembers(); // Refresh directory table
  } catch (err) {
    alert(err.message);
  }
}

async function processRedeem() {
  if (!activeMember) return alert("Please lookup a member first!");
  const rewardId = document.getElementById("rewardSelect").value;

  try {
    const res = await fetch(`/api/members/${activeMember.id}/redeem`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rewardId })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    alert(`Success! Redeemed: ${data.reward.name}`);
    lookupMember(); // Refresh balance
    loadMembers(); // Refresh directory table
  } catch (err) {
    alert(err.message);
  }
}

async function loadMembers(page = 1) {
  currentPage = page;
  const search = document.getElementById("searchInput") ? document.getElementById("searchInput").value : "";
  const sort = document.getElementById("sortSelect") ? document.getElementById("sortSelect").value : "created_at";

  try {
    const res = await fetch(`/api/members?search=${encodeURIComponent(search)}&page=${page}&limit=10&sort=${sort}&order=DESC`);
    const data = await res.json();

    const tbody = document.getElementById("memberTableBody");
    if (!tbody) return;

    tbody.innerHTML = "";
    data.data.forEach((m) => {
      tbody.innerHTML += `
        <tr>
          <td>#${m.id}</td>
          <td><strong>${m.name}</strong></td>
          <td>${m.phone}</td>
          <td>${m.balance} pts</td>
          <td><span class="badge ${m.tier}">${m.tier}</span></td>
          <td>${m.earnRate}x pts/₹100</td>
        </tr>
      `;
    });

    // Pagination info
    const pageInfo = document.getElementById("pageInfo");
    if (pageInfo) {
      pageInfo.textContent = `Page ${data.pagination.page} of ${data.pagination.totalPages || 1}`;
    }
  } catch (err) {
    console.error("Failed to load members:", err);
  }
}