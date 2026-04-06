// ── Supabase Setup ─────────────────────────────────────────────────────────────
const SUPABASE_URL = 'https://klyqajuflgrbhwuczecu.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtseXFhanVmbGdyYmh3dWN6ZWN1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ3NzA1NjQsImV4cCI6MjA5MDM0NjU2NH0.XbVgtFG7TM1iQCgN_yYawhF13tPPRZoz-y1C5UT_g60';
var supabase; // var so it's global and not block-scoped

// ── State ──────────────────────────────────────────────────────────────────────
let currentUser = null;
let selectedBooking = null;
let pendingBooking = null;
let bookings = [];
let machines = [];
let washers = [];
let dryers = [];
let machineToDelete = null;

const timeSlots = [
    '08:00 - 09:00', '09:00 - 10:00', '10:00 - 11:00', '11:00 - 12:00',
    '12:00 - 13:00', '13:00 - 14:00', '14:00 - 15:00', '15:00 - 16:00',
    '16:00 - 17:00', '17:00 - 18:00', '18:00 - 19:00', '19:00 - 20:00'
];

// No-op: replaced by direct Supabase calls
function saveData() {}

// ── EmailJS ────────────────────────────────────────────────────────────────────
window.addEventListener("load", function () {
    if (window.emailjs) {
        emailjs.init("0onfjDexOAZW5TUlp");
        console.log("EmailJS initialized");
    } else {
        console.error("EmailJS failed to load!");
    }
});

// ── Data Loaders ───────────────────────────────────────────────────────────────
async function loadMachines() {
    const { data, error } = await supabase.from('machines').select('*').order('type').order('name');
    if (error) { console.error('Error loading machines:', error); return; }
    machines = (data || []).map(m => m.name);
    washers  = (data || []).filter(m => m.type === 'washer').map(m => m.name);
    dryers   = (data || []).filter(m => m.type === 'dryer').map(m => m.name);
}

async function loadBookings() {
    const { data, error } = await supabase
        .from('bookings')
        .select('*');
    if (error) { console.error('Error loading bookings:', error); return; }
    // Map DB columns to the shape the rest of the code expects
    bookings = (data || []).map(b => ({
        id:           b.id,
        userId:       b.student_id,
        userName:     b.user_name,
        machine:      b.machine_name,
        date:         b.date,
        time:         b.time_slot,
        reminderSent: b.reminder_sent,
        createdAt:    b.created_at,
        userAuthId:   b.user_id
    }));
}

// ── Auth Functions ─────────────────────────────────────────────────────────────
function showLogin() {
    document.getElementById('loginForm').classList.remove('hidden');
    document.getElementById('signupForm').classList.add('hidden');
}

function showSignup() {
    document.getElementById('signupForm').classList.remove('hidden');
    document.getElementById('loginForm').classList.add('hidden');
}

async function login() {
    const emailOrId = document.getElementById('loginEmail').value.trim();
    const password  = document.getElementById('loginPassword').value;

    if (!emailOrId || !password) {
        showCustomAlert('Please enter your email/ID and password.', 'error');
        return;
    }

    // Resolve student ID → email if needed
    let email = emailOrId;
    if (!emailOrId.includes('@')) {
        const { data: userRow } = await supabase
            .from('users')
            .select('email')
            .eq('student_id', emailOrId)
            .single();
        if (!userRow) {
            showCustomAlert('No account found with that Student ID.', 'error');
            return;
        }
        email = userRow.email;
    }

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
        showCustomAlert('Invalid credentials! Please check your email/ID and password.', 'error');
        return;
    }

    const { data: profile } = await supabase
        .from('users')
        .select('*')
        .eq('id', data.user.id)
        .single();

    if (!profile) {
        showCustomAlert('Account profile not found.', 'error');
        return;
    }

    currentUser = {
        id:        profile.id,
        name:      profile.name,
        email:     profile.email,
        studentId: profile.student_id,
        role:      profile.role
    };

    sessionStorage.setItem('currentUser', JSON.stringify(currentUser));
    window.location.href = 'dashboard.html';
}

async function signup() {
    const name      = document.getElementById('signupName').value.trim();
    const email     = document.getElementById('signupEmail').value.trim();
    const studentId = document.getElementById('signupStudentId').value.trim();
    const password  = document.getElementById('signupPassword').value;

    if (!name || !email || !studentId || !password) {
        showCustomAlert('Please fill in all fields!', 'error');
        return;
    }

    // Check for duplicate student ID
    const { data: existing } = await supabase
        .from('users')
        .select('id')
        .or(`email.eq.${email},student_id.eq.${studentId}`)
        .maybeSingle();

    if (existing) {
        showCustomAlert('An account with that email or Student ID already exists.', 'error');
        return;
    }

    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) { showCustomAlert(error.message, 'error'); return; }

    const { error: profileError } = await supabase.from('users').insert({
        id:         data.user.id,
        name,
        email,
        student_id: studentId,
        role:       'user'
    });

    if (profileError) { showCustomAlert('Error creating profile: ' + profileError.message, 'error'); return; }

    showCustomAlert('Account created successfully! Please login.', 'success');
    setTimeout(showLogin, 1500);
}

async function logout() {
    await supabase.auth.signOut();
    sessionStorage.removeItem('currentUser');
    currentUser = null;
    window.location.href = 'index.html';
}

// ── Auth Check (dashboard.html) ───────────────────────────────────────────────
async function checkAuth() {
    if (!window.location.pathname.includes('dashboard.html')) return;

    const saved = sessionStorage.getItem('currentUser');
    if (!saved) { window.location.href = 'index.html'; return; }

    currentUser = JSON.parse(saved);

    await loadMachines();
    await loadBookings();

    if (currentUser.role === 'admin') {
        showAdminDashboard();
    } else {
        showUserDashboard();
    }
}

// ── Dashboard Rendering ────────────────────────────────────────────────────────
function showUserDashboard() {
    document.getElementById('userDashboard').style.display = 'block';
    document.getElementById('adminDashboard').style.display = 'none';
    document.getElementById('userName').textContent      = currentUser.name;
    document.getElementById('userStudentId').textContent = currentUser.studentId;
    renderSchedule();
    renderMyBookings();
}

function showAdminDashboard() {
    document.getElementById('adminDashboard').style.display = 'block';
    document.getElementById('userDashboard').style.display  = 'none';
    renderAdminBookings();
    renderMachineList();
}

// ── Tab Switching ──────────────────────────────────────────────────────────────
function showTab(tab) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    event.target.classList.add('active');
    if (tab === 'schedule') {
        document.getElementById('scheduleTab').classList.remove('hidden');
        document.getElementById('mybookingsTab').classList.add('hidden');
        renderSchedule();
    } else {
        document.getElementById('scheduleTab').classList.add('hidden');
        document.getElementById('mybookingsTab').classList.remove('hidden');
        renderMyBookings();
    }
}

function showAdminTab(tab) {
    document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
    event.target.classList.add('active');
    document.querySelectorAll('.admin-content').forEach(c => c.classList.remove('active'));
    if (tab === 'bookings') {
        document.getElementById('adminBookingsTab').classList.add('active');
        renderAdminBookings();
    } else if (tab === 'machines') {
        document.getElementById('adminMachinesTab').classList.add('active');
        renderMachineList();
        const type = document.getElementById('newMachineType').value;
        document.getElementById('newMachineNumber').value = getNextMachineNumber(type);
    }
}

// ── Schedule ───────────────────────────────────────────────────────────────────
function getTodayDate() {
    return new Date().toISOString().split('T')[0];
}

function renderSchedule() {
    const grid = document.getElementById('scheduleGrid');
    if (!grid) return;
    grid.innerHTML = '';
    const today = getTodayDate();

    machines.forEach(machine => {
        const card = document.createElement('div');
        card.className = 'machine-card';
        card.innerHTML = `<h3>${machine}</h3>`;

        timeSlots.forEach(time => {
            const booking = bookings.find(b => b.machine === machine && b.time === time && b.date === today);
            const slot = document.createElement('div');
            slot.className = 'time-slot';

            if (booking) {
                if (booking.userId === currentUser.studentId) {
                    slot.className += ' my-booking';
                    slot.innerHTML = `<span>${time}</span><span>Your Booking</span>`;
                } else {
                    slot.className += ' booked';
                    slot.innerHTML = `<span>${time}</span><span>Booked</span>`;
                }
            } else {
                slot.className += ' available';
                slot.innerHTML = `<span>${time}</span><span>Available</span>`;
                slot.onclick = () => openBookingModal(machine, today, time);
            }
            card.appendChild(slot);
        });
        grid.appendChild(card);
    });
}

// ── Booking Limits ─────────────────────────────────────────────────────────────
function countUserWasherBookings(userId) {
    const today = getTodayDate();
    return bookings.filter(b => b.userId === userId && b.date === today && washers.includes(b.machine)).length;
}

function countUserDryerBookings(userId) {
    const today = getTodayDate();
    return bookings.filter(b => b.userId === userId && b.date === today && dryers.includes(b.machine)).length;
}

function isMachineWasher(machine) { return washers.includes(machine); }
function isMachineDryer(machine)  { return dryers.includes(machine); }

// ── Booking Modal ──────────────────────────────────────────────────────────────
function openBookingModal(machine, date, time) {
    if (isMachineWasher(machine) && countUserWasherBookings(currentUser.studentId) >= 2) {
        showCustomAlert('You are only permitted to book 2 washer slots per day.', 'error');
        return;
    }
    if (isMachineDryer(machine) && countUserDryerBookings(currentUser.studentId) >= 2) {
        showCustomAlert('You are only permitted to book 2 dryer slots per day.', 'error');
        return;
    }
    pendingBooking = { machine, date, time };
    document.getElementById('modalMachine').textContent = machine;
    document.getElementById('modalDate').textContent    = date;
    document.getElementById('modalTime').textContent    = time;
    document.getElementById('bookingModal').style.display = 'flex';
}

function closeModal() {
    document.getElementById('bookingModal').style.display = 'none';
    pendingBooking = null;
}

async function confirmBooking() {
    if (!pendingBooking) return;
    const userId = currentUser.studentId;
    const today  = getTodayDate();

    const userWasherBookings = bookings.filter(b => b.userId === userId && b.date === today && washers.includes(b.machine));
    const userDryerBookings  = bookings.filter(b => b.userId === userId && b.date === today && dryers.includes(b.machine));

    if (isMachineWasher(pendingBooking.machine) && userWasherBookings.length >= 2) {
        showCustomAlert('You are only permitted to book 2 washer slots per day.', 'error');
        return;
    }
    if (isMachineDryer(pendingBooking.machine) && userDryerBookings.length >= 2) {
        showCustomAlert('You are only permitted to book 2 dryer slots per day.', 'error');
        return;
    }

    const { error } = await supabase.from('bookings').insert({
        user_id:      currentUser.id,
        machine_name: pendingBooking.machine,
        user_name:    currentUser.name,
        student_id:   currentUser.studentId,
        date:         pendingBooking.date,
        time_slot:    pendingBooking.time,
        reminder_sent: false
    });

    if (error) {
        if (error.code === '23505') {
            showCustomAlert('That slot was just taken! Please choose another.', 'error');
        } else {
            showCustomAlert('Error creating booking: ' + error.message, 'error');
        }
        return;
    }

    await loadBookings();
    closeModal();
    renderSchedule();
    renderMyBookings();
    showCustomAlert('Booking confirmed! Your Student ID is: ' + currentUser.studentId, 'success');
}

// ── My Bookings ────────────────────────────────────────────────────────────────
function canModifyBooking(booking) {
    const now             = new Date();
    const bookingDateTime = new Date(booking.date + 'T' + booking.time.split(' - ')[0]);
    return (bookingDateTime - now) / (1000 * 60) >= 30;
}

function getTimeUntilBooking(booking) {
    const now             = new Date();
    const bookingDateTime = new Date(booking.date + 'T' + booking.time.split(' - ')[0]);
    const minutesDiff     = Math.floor((bookingDateTime - now) / (1000 * 60));
    if (minutesDiff < 0)  return 'Started';
    if (minutesDiff < 60) return `${minutesDiff} min`;
    return `${Math.floor(minutesDiff / 60)}h ${minutesDiff % 60}m`;
}

function renderMyBookings() {
    const container = document.getElementById('myBookingsList');
    if (!container) return;

    const myBookings = bookings.filter(b => b.userId === currentUser.studentId);

    if (myBookings.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <h3>No Bookings Yet</h3>
                <p>Book a time slot from the "Available Machines" tab to get started!</p>
            </div>`;
        return;
    }

    container.innerHTML = myBookings.map(booking => {
        const canModify = canModifyBooking(booking);
        const timeUntil = getTimeUntilBooking(booking);
        const isPast    = timeUntil === 'Started';
        return `
        <div class="booking-card">
            <h3>${booking.machine}</h3>
            <p><strong>Date:</strong> ${booking.date}</p>
            <p><strong>Time:</strong> ${booking.time}</p>
            <p><strong>Your ID:</strong> ${booking.userId}</p>
            ${!isPast ? `<p><strong>Starts in:</strong> ${timeUntil}</p>` : '<p><strong>Status:</strong> In Progress/Completed</p>'}
            ${!canModify && !isPast ? '<p style="color:#ef4444;font-size:14px;margin-top:10px;">Cannot modify - less than 30 minutes until start</p>' : ''}
            <div class="booking-actions">
                <button class="btn btn-success" onclick="openRescheduleModal('${booking.id}')" ${!canModify ? 'disabled style="opacity:0.5;cursor:not-allowed;"' : ''}>Reschedule</button>
                <button class="btn btn-danger"  onclick="cancelBooking('${booking.id}')"        ${!canModify ? 'disabled style="opacity:0.5;cursor:not-allowed;"' : ''}>Cancel</button>
            </div>
        </div>`;
    }).join('');
}

async function cancelBooking(bookingId) {
    const booking = bookings.find(b => b.id === bookingId);
    if (!canModifyBooking(booking)) {
        showCustomAlert('Cancellations must be made at least 30 minutes before the start time.', 'error');
        return;
    }
    showCustomConfirm('Are you sure you want to cancel this booking?', async () => {
        const { error } = await supabase.from('bookings').delete().eq('id', bookingId);
        if (error) { showCustomAlert('Error cancelling booking.', 'error'); return; }
        await loadBookings();
        renderSchedule();
        renderMyBookings();
        showCustomAlert('Booking cancelled successfully!', 'success');
    });
}

// ── Reschedule ─────────────────────────────────────────────────────────────────
function openRescheduleModal(bookingId) {
    selectedBooking = bookings.find(b => b.id === bookingId);
    if (!canModifyBooking(selectedBooking)) {
        showCustomAlert('Changes must be made at least 30 minutes before the start time.', 'error');
        return;
    }
    const machineSelect = document.getElementById('rescheduleMachine');
    machineSelect.innerHTML = machines.map(m =>
        `<option value="${m}" ${m === selectedBooking.machine ? 'selected' : ''}>${m}</option>`
    ).join('');
    document.getElementById('rescheduleDate').value = getTodayDate();
    document.getElementById('rescheduleDate').min   = getTodayDate();
    updateRescheduleTimeSlots();
    document.getElementById('rescheduleModal').style.display = 'flex';
}

function closeRescheduleModal() {
    document.getElementById('rescheduleModal').style.display = 'none';
    selectedBooking = null;
}

function updateRescheduleTimeSlots() {
    const machine    = document.getElementById('rescheduleMachine').value;
    const date       = document.getElementById('rescheduleDate').value;
    const timeSelect = document.getElementById('rescheduleTime');

    const machineSelect = document.getElementById('rescheduleMachine');
    machineSelect.innerHTML = machines.map(m =>
        `<option value="${m}" ${m === selectedBooking.machine ? 'selected' : ''}>${m}</option>`
    ).join('');

    const userId = currentUser.studentId;
    const availableSlots = timeSlots.filter(time => {
        const isBooked = bookings.some(b =>
            b.machine === machine && b.time === time && b.date === date && b.id !== selectedBooking.id
        );
        if (isBooked) return false;

        if (isMachineWasher(machine) && machine !== selectedBooking.machine) {
            const count = bookings.filter(b => b.userId === userId && b.date === date && washers.includes(b.machine) && b.id !== selectedBooking.id).length;
            if (count >= 2) return false;
        }
        if (isMachineDryer(machine) && machine !== selectedBooking.machine) {
            const count = bookings.filter(b => b.userId === userId && b.date === date && dryers.includes(b.machine) && b.id !== selectedBooking.id).length;
            if (count >= 2) return false;
        }
        return true;
    });

    timeSelect.innerHTML = availableSlots.map(time =>
        `<option value="${time}" ${time === selectedBooking.time ? 'selected' : ''}>${time}</option>`
    ).join('');
}

async function confirmReschedule() {
    const machine = document.getElementById('rescheduleMachine').value;
    const date    = document.getElementById('rescheduleDate').value;
    const time    = document.getElementById('rescheduleTime').value;
    const userId  = currentUser.studentId;

    const originalWasWasher = isMachineWasher(selectedBooking.machine);
    const newIsWasher       = isMachineWasher(machine);
    const newIsDryer        = isMachineDryer(machine);

    if (originalWasWasher !== newIsWasher) {
        if (newIsWasher) {
            const count = bookings.filter(b => b.userId === userId && b.date === date && washers.includes(b.machine) && b.id !== selectedBooking.id).length;
            if (count >= 2) { showCustomAlert('You are only permitted to book 2 washer slots per day.', 'error'); return; }
        }
        if (newIsDryer) {
            const count = bookings.filter(b => b.userId === userId && b.date === date && dryers.includes(b.machine) && b.id !== selectedBooking.id).length;
            if (count >= 2) { showCustomAlert('You are only permitted to book 2 dryer slots per day.', 'error'); return; }
        }
    }

    const { error } = await supabase.from('bookings').update({
        machine_name: machine,
        date,
        time_slot:    time,
        reminder_sent: false
    }).eq('id', selectedBooking.id);

    if (error) { showCustomAlert('Error rescheduling: ' + error.message, 'error'); return; }

    await loadBookings();
    closeRescheduleModal();
    renderSchedule();
    renderMyBookings();
    showCustomAlert('Booking rescheduled successfully!', 'success');
}

// ── Admin Bookings ─────────────────────────────────────────────────────────────
function renderAdminBookings() {
    const tbody = document.getElementById('adminBookingsTable');
    if (!tbody) return;

    if (bookings.length === 0) {
        tbody.innerHTML = `
            <tr><td colspan="7">
                <div class="empty-state">
                    <h3>No Bookings Yet</h3>
                    <p>Bookings will appear here once students make reservations</p>
                </div>
            </td></tr>`;
        return;
    }

    const sorted = [...bookings].sort((a, b) =>
        a.date !== b.date ? a.date.localeCompare(b.date) : a.time.localeCompare(b.time)
    );

    tbody.innerHTML = sorted.map(booking => `
        <tr>
            <td>${booking.userName}</td>
            <td>${booking.userId}</td>
            <td>${booking.machine}</td>
            <td>${booking.date}</td>
            <td>${booking.time}</td>
            <td><span class="status-badge status-active">Active</span></td>
            <td>
                <button class="btn btn-danger" style="padding:6px 12px;font-size:14px;width:auto;"
                    onclick="adminCancelBooking('${booking.id}')">Cancel</button>
            </td>
        </tr>`
    ).join('');
}

async function adminCancelBooking(bookingId) {
    showCustomConfirm('Are you sure you want to cancel this booking?', async () => {
        const { error } = await supabase.from('bookings').delete().eq('id', bookingId);
        if (error) { showCustomAlert('Error cancelling booking.', 'error'); return; }
        await loadBookings();
        renderAdminBookings();
        showCustomAlert('Booking cancelled successfully!', 'success');
    });
}

// ── CSV Export ─────────────────────────────────────────────────────────────────
function exportCSV() {
    const rows = document.querySelectorAll('#adminBookingsTable tr');
    let csv = "Student Name,Student ID,Machine,Date,Time,Status\n";
    rows.forEach(row => {
        const cols = row.querySelectorAll('td');
        const rowData = [...cols].map(col => col.innerText.replace(/,/g, ''));
        if (rowData.length > 1) csv += rowData.join(',') + "\n";
    });
    const a = document.createElement('a');
    a.href     = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = 'laundry-bookings.csv';
    a.click();
}

// ── Machine Management ─────────────────────────────────────────────────────────
function generateMachineName(type, number) {
    return `${type === 'washer' ? 'Washer' : 'Dryer'} ${number}`;
}

function getNextMachineNumber(type) {
    const list    = type === 'washer' ? washers : dryers;
    const numbers = list.map(m => { const match = m.match(/(\d+)$/); return match ? parseInt(match[1]) : 0; });
    return numbers.length > 0 ? Math.max(...numbers) + 1 : 1;
}

async function addNewMachine() {
    const type        = document.getElementById('newMachineType').value;
    const numberInput = document.getElementById('newMachineNumber').value;

    if (!type || !numberInput) { showCustomAlert('Please select a type and enter a number', 'error'); return; }
    const number = parseInt(numberInput);
    if (isNaN(number) || number < 1) { showCustomAlert('Please enter a valid number (minimum 1)', 'error'); return; }

    const machineName = generateMachineName(type, number);

    if ((type === 'washer' && washers.includes(machineName)) || (type === 'dryer' && dryers.includes(machineName))) {
        showCustomAlert(`${machineName} already exists!`, 'error');
        return;
    }

    const { error } = await supabase.from('machines').insert({ name: machineName, type });
    if (error) { showCustomAlert('Error adding machine: ' + error.message, 'error'); return; }

    await loadMachines();
    renderMachineList();
    showCustomAlert(`${machineName} added successfully!`, 'success');
    document.getElementById('newMachineNumber').value = getNextMachineNumber(type);
}

function renderMachineList() {
    const machinesList = document.getElementById('machinesList');
    if (!machinesList) return;

    const allMachines = [
        ...washers.map(name => ({ name, type: 'washer' })),
        ...dryers.map(name => ({ name, type: 'dryer' }))
    ];

    allMachines.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'washer' ? -1 : 1;
        return parseInt(a.name.match(/(\d+)$/)[1]) - parseInt(b.name.match(/(\d+)$/)[1]);
    });

    machinesList.innerHTML = allMachines.map(machine => `
        <div class="machine-item">
            <span class="machine-type ${machine.type}">${machine.type.toUpperCase()}</span>
            <h4>${machine.name}</h4>
            <p>Type: ${machine.type === 'washer' ? 'Washer' : 'Dryer'}</p>
            <div style="margin-top:10px;">
                <button class="btn btn-danger" onclick="promptDeleteMachine('${machine.name}','${machine.type}')"
                        style="padding:6px 12px;font-size:14px;">Remove</button>
            </div>
        </div>`
    ).join('');
}

function promptDeleteMachine(machineName, machineType) {
    machineToDelete = { name: machineName, type: machineType };
    document.getElementById('deleteMachineName').textContent = machineName;
    document.getElementById('deleteMachineModal').style.display = 'flex';
}

async function confirmDeleteMachine() {
    if (!machineToDelete) return;
    const { name } = machineToDelete;

    // Delete bookings for this machine first
    await supabase.from('bookings').delete().eq('machine_name', name);

    const { error } = await supabase.from('machines').delete().eq('name', name);
    if (error) { showCustomAlert('Error deleting machine: ' + error.message, 'error'); return; }

    await loadMachines();
    await loadBookings();
    renderMachineList();
    renderSchedule();
    renderAdminBookings();
    closeDeleteModal();
    showCustomAlert(`${name} has been removed.`, 'success');
}

function closeDeleteModal() {
    document.getElementById('deleteMachineModal').style.display = 'none';
    machineToDelete = null;
}

// ── Email Reminders ────────────────────────────────────────────────────────────
async function checkForUpcomingReminders() {
    const now = new Date();
    console.log("REMINDER CHECK at:", now.toLocaleString());

    if (bookings.length === 0) return;

    for (const booking of bookings) {
        if (booking.reminderSent) continue;

        try {
            const [startTimeStr] = booking.time.split(" - ");
            const bookingDateTime = new Date(`${booking.date}T${startTimeStr}:00`);
            if (isNaN(bookingDateTime.getTime())) continue;

            const diffMinutes = (bookingDateTime - now) / (1000 * 60);

            if (diffMinutes <= 60 && diffMinutes >= 0) {
                // Fetch user email from DB
                const { data: userRow } = await supabase
                    .from('users')
                    .select('email')
                    .eq('student_id', booking.userId)
                    .single();

                if (userRow && userRow.email) {
                    sendReminderEmail(booking, userRow.email);
                }
            }
        } catch (err) {
            console.error('Error processing reminder:', err);
        }
    }
}

async function sendReminderEmail(booking, userEmail) {
    console.log("Sending reminder to", userEmail);
    emailjs.send("service_e8vg3h8", "template_hgt6pkh", {
        to_email: userEmail,
        machine:  booking.machine,
        date:     booking.date,
        time:     booking.time,
    })
    .then(async () => {
        console.log("Reminder sent to", userEmail);
        await supabase.from('bookings').update({ reminder_sent: true }).eq('id', booking.id);
        await loadBookings();
    })
    .catch(err => console.error("EmailJS Error:", err));
}

// ── Auto Refresh ───────────────────────────────────────────────────────────────
setInterval(async () => {
    if (!currentUser) return;
    await loadBookings();
    if (currentUser.role === 'admin') {
        renderAdminBookings();
    } else {
        renderSchedule();
        renderMyBookings();
    }
    checkForUpcomingReminders();
}, 60000);

// ── UI Helpers ─────────────────────────────────────────────────────────────────
function showCustomAlert(message, type = 'info') {
    const alertDiv = document.createElement('div');
    alertDiv.className = 'custom-alert';

    let iconSvg = '', alertClass = '';
    if (type === 'success') {
        alertClass = 'alert-success-custom';
        iconSvg = `<svg class="alert-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>`;
    } else if (type === 'error') {
        alertClass = 'alert-error-custom';
        iconSvg = `<svg class="alert-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>`;
    } else {
        alertClass = 'alert-info-custom';
        iconSvg = `<svg class="alert-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`;
    }

    alertDiv.innerHTML = `
        <div class="custom-alert-content ${alertClass}">
            <div class="alert-header">${iconSvg}
                <h3 class="alert-title">${type === 'success' ? 'Success' : type === 'error' ? 'Error' : 'Info'}</h3>
            </div>
            <p class="alert-message">${message}</p>
            <button class="btn btn-primary alert-btn" onclick="this.closest('.custom-alert').remove()">OK</button>
        </div>`;
    document.body.appendChild(alertDiv);
    setTimeout(() => alertDiv.querySelector('button').focus(), 100);
}

function showCustomConfirm(message, onConfirm) {
    const confirmDiv = document.createElement('div');
    confirmDiv.className = 'custom-alert';
    confirmDiv.innerHTML = `
        <div class="custom-alert-content">
            <p>${message}</p>
            <div style="display:flex;gap:10px;margin-top:20px;">
                <button class="btn btn-primary"   style="flex:1;">Confirm</button>
                <button class="btn btn-secondary" style="flex:1;">Cancel</button>
            </div>
        </div>`;
    document.body.appendChild(confirmDiv);
    confirmDiv.querySelector('.btn-primary').onclick   = () => { confirmDiv.remove(); onConfirm(); };
    confirmDiv.querySelector('.btn-secondary').onclick = () => confirmDiv.remove();
    setTimeout(() => confirmDiv.querySelector('.btn-secondary').focus(), 100);
}

// ── DOMContentLoaded ───────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function () {
    // Initialize Supabase here so the CDN script is guaranteed to be loaded
    supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

    const rescheduleMachine = document.getElementById('rescheduleMachine');
    const rescheduleDate    = document.getElementById('rescheduleDate');
    const newMachineType    = document.getElementById('newMachineType');

    if (rescheduleMachine) rescheduleMachine.addEventListener('change', updateRescheduleTimeSlots);
    if (rescheduleDate)    rescheduleDate.addEventListener('change', updateRescheduleTimeSlots);
    if (newMachineType) {
        newMachineType.addEventListener('change', function () {
            document.getElementById('newMachineNumber').value = getNextMachineNumber(this.value);
        });
    }

    checkAuth();
});
