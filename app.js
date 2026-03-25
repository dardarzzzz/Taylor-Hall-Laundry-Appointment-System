// Initialize data storage
let users = JSON.parse(localStorage.getItem('laundryUsers')) || [
{ email: 'admin@taylor.edu', password: 'admin123', role: 'admin', name: 'Admin User', studentId: 'ADMIN001' }
];

window.addEventListener("load", function () {
    if (window.emailjs) {
        emailjs.init("0onfjDexOAZW5TUlp");
        console.log("Emails initialized");
    } else {
        console.error("Emails failed to load!");
    }
});


let bookings = JSON.parse(localStorage.getItem('laundryBookings')) || [];
let currentUser = null;
let selectedBooking = null;
let pendingBooking = null;


// Load machines
let washers = JSON.parse(localStorage.getItem('laundryWashers')) || ['Washer 1', 'Washer 2', 'Washer 3'];
let dryers = JSON.parse(localStorage.getItem('laundryDryers')) || ['Dryer 1', 'Dryer 2'];
let machines = [...washers, ...dryers];
let machineToDelete = null;


const timeSlots = [
'08:00 - 09:00', '09:00 - 10:00', '10:00 - 11:00', '11:00 - 12:00',
'12:00 - 13:00', '13:00 - 14:00', '14:00 - 15:00', '15:00 - 16:00',
'16:00 - 17:00', '17:00 - 18:00', '18:00 - 19:00', '19:00 - 20:00'
];


function saveData() {
localStorage.setItem('laundryUsers', JSON.stringify(users));
localStorage.setItem('laundryBookings', JSON.stringify(bookings));
localStorage.setItem('laundryWashers', JSON.stringify(washers));
localStorage.setItem('laundryDryers', JSON.stringify(dryers));
}


// CSV EXPORT FUNCTION
function exportCSV() {
const rows = document.querySelectorAll('#adminBookingsTable tr');


let csv = "Student Name,Student ID,Machine,Date,Time,Status\n";


rows.forEach(row => {
const cols = row.querySelectorAll('td');
const rowData = [...cols].map(col => col.innerText.replace(/,/g, ''));
csv += rowData.join(',') + "\n";
});


const blob = new Blob([csv], { type: 'text/csv' });
const url = URL.createObjectURL(blob);


const a = document.createElement('a');
a.href = url;
a.download = 'laundry-bookings.csv';
a.click();
}


// Show/Hide forms
function showLogin() {
    document.getElementById('loginForm').classList.remove('hidden');
    document.getElementById('signupForm').classList.add('hidden');
}

function showSignup() {
    document.getElementById('signupForm').classList.remove('hidden');
    document.getElementById('loginForm').classList.add('hidden');
}

// Login
function login() {
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;

    const user = users.find(u => (u.email === email || u.studentId === email) && u.password === password);

    if (user) {
        currentUser = user;
        localStorage.setItem('currentUser', JSON.stringify(user));
        
        // Redirect to dashboard
        window.location.href = 'dashboard.html';
    } else {
        showCustomAlert('Invalid credentials! Please check your email/ID and password.', 'error');
    }
}

// Signup
function signup() {
    const name = document.getElementById('signupName').value;
    const email = document.getElementById('signupEmail').value;
    const studentId = document.getElementById('signupStudentId').value;
    const password = document.getElementById('signupPassword').value;

    if (!name || !email || !studentId || !password) {
        showCustomAlert('Please fill in all fields!', 'error');
        return;
    }

    if (users.find(u => u.email === email || u.studentId === studentId)) {
        showCustomAlert('User already exists!', 'error');
        return;
    }

    users.push({
        name,
        email,
        studentId,
        password,
        role: 'user'
    });

    saveData();
    showCustomAlert('Account created successfully! Please login.', 'success');
    setTimeout(() => {
        showLogin();
    }, 1500);
}

// Logout
function logout() {
    currentUser = null;
    localStorage.removeItem('currentUser');
    window.location.href = 'index.html';
}

// Check if user is logged in on dashboard page
function checkAuth() {
    if (window.location.pathname.includes('dashboard.html')) {
        const savedUser = localStorage.getItem('currentUser');
        if (!savedUser) {
            window.location.href = 'index.html';
            return;
        }
        
        currentUser = JSON.parse(savedUser);
        if (currentUser.role === 'admin') {
            showAdminDashboard();
        } else {
            showUserDashboard();
        }
    }
}

// Show User Dashboard
function showUserDashboard() {
    document.getElementById('userDashboard').style.display = 'block';
    document.getElementById('adminDashboard').style.display = 'none';
    document.getElementById('userName').textContent = currentUser.name;
    document.getElementById('userStudentId').textContent = currentUser.studentId;
    
    // Add booking limits display
    const today = getTodayDate();
    const washerCount = countUserWasherBookings(currentUser.studentId);
    const dryerCount = countUserDryerBookings(currentUser.studentId);
    
    // You could add this information to your dashboard
    console.log(`User has ${washerCount}/2 washers and ${dryerCount}/2 dryers booked today`);
    
    renderSchedule();
    renderMyBookings();
}

// Helper function to generate machine names
function generateMachineName(type, number) {
    const prefix = type === 'washer' ? 'Washer' : 'Dryer';
    return `${prefix} ${number}`;
}

// Helper function to find next available number for a machine type
function getNextMachineNumber(type) {
    const machineList = type === 'washer' ? washers : dryers;
    const existingNumbers = machineList.map(machine => {
        const match = machine.match(/(\d+)$/);
        return match ? parseInt(match[1]) : 0;
    });
    
    return existingNumbers.length > 0 ? Math.max(...existingNumbers) + 1 : 1;
}

// Function to add a new machine
function addNewMachine() {
    const type = document.getElementById('newMachineType').value;
    const numberInput = document.getElementById('newMachineNumber').value;
    
    if (!type || !numberInput) {
        showCustomAlert('Please select a type and enter a number', 'error');
        return;
    }
    
    const number = parseInt(numberInput);
    if (isNaN(number) || number < 1) {
        showCustomAlert('Please enter a valid number (minimum 1)', 'error');
        return;
    }
    
    const machineName = generateMachineName(type, number);
    
    // Check if machine already exists
    if (type === 'washer' && washers.includes(machineName)) {
        showCustomAlert(`Washer ${number} already exists!`, 'error');
        return;
    }
    
    if (type === 'dryer' && dryers.includes(machineName)) {
        showCustomAlert(`Dryer ${number} already exists!`, 'error');
        return;
    }
    
    // Add the machine
    if (type === 'washer') {
        washers.push(machineName);
    } else {
        dryers.push(machineName);
    }
    
    // Update the machines array
    machines = [...washers, ...dryers];
    
    // Save and refresh
    saveData();
    renderMachineList();
    showCustomAlert(`${machineName} added successfully!`, 'success');
    
    // Reset form
    document.getElementById('newMachineNumber').value = getNextMachineNumber(type);
}

// Function to render machine list in admin panel
function renderMachineList() {
    const machinesList = document.getElementById('machinesList');
    if (!machinesList) return;
    
    // Combine and sort all machines
    const allMachines = [
        ...washers.map(name => ({ name, type: 'washer' })),
        ...dryers.map(name => ({ name, type: 'dryer' }))
    ];
    
    // Sort by type and then by number
    allMachines.sort((a, b) => {
        if (a.type !== b.type) {
            return a.type === 'washer' ? -1 : 1;
        }
        const numA = parseInt(a.name.match(/(\d+)$/)[1]);
        const numB = parseInt(b.name.match(/(\d+)$/)[1]);
        return numA - numB;
    });
    
    machinesList.innerHTML = allMachines.map(machine => `
        <div class="machine-item">
            <span class="machine-type ${machine.type}">${machine.type.toUpperCase()}</span>
            <h4>${machine.name}</h4>
            <p>Type: ${machine.type === 'washer' ? 'Washer' : 'Dryer'}</p>
            <div style="margin-top: 10px;">
                <button class="btn btn-danger" onclick="promptDeleteMachine('${machine.name}', '${machine.type}')" 
                        style="padding: 6px 12px; font-size: 14px;">
                    Remove
                </button>
            </div>
        </div>
    `).join('');
}

// Function to prompt for machine deletion
function promptDeleteMachine(machineName, machineType) {
    machineToDelete = { name: machineName, type: machineType };
    document.getElementById('deleteMachineName').textContent = machineName;
    document.getElementById('deleteMachineModal').style.display = 'flex';
}

// Function to confirm machine deletion
function confirmDeleteMachine() {
    if (!machineToDelete) return;
    
    const { name, type } = machineToDelete;
    
    // Remove from appropriate array
    if (type === 'washer') {
        washers = washers.filter(m => m !== name);
    } else {
        dryers = dryers.filter(m => m !== name);
    }
    
    // Remove all bookings for this machine
    const bookingsBefore = bookings.length;
    bookings = bookings.filter(b => b.machine !== name);
    const bookingsRemoved = bookingsBefore - bookings.length;
    
    // Update machines array
    machines = [...washers, ...dryers];
    
    // Save data
    saveData();
    
    // Refresh displays
    renderMachineList();
    renderSchedule();
    renderAdminBookings();
    
    // Close modal
    closeDeleteModal();
    
    showCustomAlert(`${name} has been removed. ${bookingsRemoved} booking(s) were cancelled.`, 'success');
}

// Close delete confirmation modal
function closeDeleteModal() {
    document.getElementById('deleteMachineModal').style.display = 'none';
    machineToDelete = null;
}

// Function to show admin tabs
function showAdminTab(tab) {
    // Update tab buttons
    document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
    event.target.classList.add('active');
    
    // Show/hide content
    document.querySelectorAll('.admin-content').forEach(content => {
        content.classList.remove('active');
    });
    
    if (tab === 'bookings') {
        document.getElementById('adminBookingsTab').classList.add('active');
        renderAdminBookings();
    } else if (tab === 'machines') {
        document.getElementById('adminMachinesTab').classList.add('active');
        renderMachineList();
        // Set default value for new machine number
        const type = document.getElementById('newMachineType').value;
        document.getElementById('newMachineNumber').value = getNextMachineNumber(type);
    }
}

// Show the showAdminDashboard function
function showAdminDashboard() {
    document.getElementById('adminDashboard').style.display = 'block';
    document.getElementById('userDashboard').style.display = 'none';
    renderAdminBookings();
    renderMachineList();
}

// Tab switching
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

// Get today's date
function getTodayDate() {
    const today = new Date();
    return today.toISOString().split('T')[0];
}

// Render schedule
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
            const booking = bookings.find(b => 
                b.machine === machine && 
                b.time === time && 
                b.date === today
            );

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


//helper functions for washers and dryers
function countUserWasherBookings(userId) {
    const today = getTodayDate();
    return bookings.filter(b => 
        b.userId === userId && 
        b.date === today &&
        washers.includes(b.machine)
    ).length;
}

function countUserDryerBookings(userId) {
    const today = getTodayDate();
    return bookings.filter(b => 
        b.userId === userId && 
        b.date === today &&
        dryers.includes(b.machine)
    ).length;
}

function isMachineWasher(machine) {
    return washers.includes(machine);
}

function isMachineDryer(machine) {
    return dryers.includes(machine);
}

// Check if booking can be modified (30 minutes before start)
function canModifyBooking(booking) {
    const now = new Date();
    const bookingDateTime = new Date(booking.date + 'T' + booking.time.split(' - ')[0]);
    const timeDiff = bookingDateTime - now;
    const minutesDiff = timeDiff / (1000 * 60);
    
    return minutesDiff >= 30;
}

// Get time until booking starts
function getTimeUntilBooking(booking) {
    const now = new Date();
    const bookingDateTime = new Date(booking.date + 'T' + booking.time.split(' - ')[0]);
    const timeDiff = bookingDateTime - now;
    const minutesDiff = Math.floor(timeDiff / (1000 * 60));
    
    if (minutesDiff < 0) return 'Started';
    if (minutesDiff < 60) return `${minutesDiff} min`;
    const hours = Math.floor(minutesDiff / 60);
    const mins = minutesDiff % 60;
    return `${hours}h ${mins}m`;
}

// Open booking modal
function openBookingModal(machine, date, time) {
    if (isMachineWasher(machine)) {
        const washerCount = countUserWasherBookings(currentUser.studentId);
        if (washerCount >= 2) {
            showCustomAlert('You are only permitted to book 2 washer slots and 2 dryer slots per day.', 'error');
            return;
        }
    }
    
    // Check if this is a dryer booking attempt
    if (isMachineDryer(machine)) {
        const dryerCount = countUserDryerBookings(currentUser.studentId);
        if (dryerCount >= 2) {
            showCustomAlert('You are only permitted to book 2 washer slots and 2 dryer slots per day.', 'error');
            return;
        }
    }
    
    pendingBooking = { machine, date, time };
    document.getElementById('modalMachine').textContent = machine;
    document.getElementById('modalDate').textContent = date;
    document.getElementById('modalTime').textContent = time;
    document.getElementById('bookingModal').style.display = 'flex';
}

function closeModal() {
    document.getElementById('bookingModal').style.display = 'none';
    pendingBooking = null;
}

// Confirm booking
// Confirm booking
function confirmBooking() {
    if (!pendingBooking) return;
    const userId = currentUser.studentId;
    const today = getTodayDate();

    // Count current bookings for today
    const userWasherBookings = bookings.filter(b => 
        b.userId === userId && 
        b.date === today &&
        washers.includes(b.machine)
    );

    const userDryerBookings = bookings.filter(b => 
        b.userId === userId && 
        b.date === today &&
        dryers.includes(b.machine)
    );

    // Check limits based on machine type
    if (isMachineWasher(pendingBooking.machine) && userWasherBookings.length >= 2) {
        showCustomAlert('You are only permitted to book 2 washer slots per day.', 'error');
        return;
    }
    
    if (isMachineDryer(pendingBooking.machine) && userDryerBookings.length >= 2) {
        showCustomAlert('You are only permitted to book 2 dryer slots per day.', 'error');
        return;
    }

    const booking = {
        id: Date.now().toString(),
        userId: userId,
        userName: currentUser.name,
        machine: pendingBooking.machine,
        date: pendingBooking.date,
        time: pendingBooking.time,
        createdAt: new Date().toISOString(),
        reminderSent: false // ADD THIS LINE - CRITICAL!
    };

    bookings.push(booking);
    saveData();
    
    console.log('Booking created:', booking);
    console.log('All bookings:', bookings);
    
    closeModal();
    renderSchedule();
    renderMyBookings();
    showCustomAlert('Booking confirmed! Your Student ID is: ' + currentUser.studentId, 'success');
}

// Render my bookings
function renderMyBookings() {
    const container = document.getElementById('myBookingsList');
    if (!container) return;
    
    const myBookings = bookings.filter(b => b.userId === currentUser.studentId);

    console.log('Rendering my bookings. Total:', myBookings.length);
    console.log('Current user ID:', currentUser.studentId);
    console.log('My bookings:', myBookings);

    if (myBookings.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <h3>No Bookings Yet</h3>
                <p>Book a time slot from the "Available Machines" tab to get started!</p>
            </div>
        `;
        return;
    }

    container.innerHTML = myBookings.map(booking => {
        const canModify = canModifyBooking(booking);
        const timeUntil = getTimeUntilBooking(booking);
        const isPast = timeUntil === 'Started';
        
        return `
        <div class="booking-card">
            <h3>${booking.machine}</h3>
            <p><strong>Date:</strong> ${booking.date}</p>
            <p><strong>Time:</strong> ${booking.time}</p>
            <p><strong>Your ID:</strong> ${booking.userId}</p>
            ${!isPast ? `<p><strong>Starts in:</strong> ${timeUntil}</p>` : '<p><strong>Status:</strong> In Progress/Completed</p>'}
            ${!canModify && !isPast ? '<p style="color: #ef4444; font-size: 14px; margin-top: 10px;">Cannot modify - less than 30 minutes until start</p>' : ''}
            <div class="booking-actions">
                <button class="btn btn-success" onclick="openRescheduleModal('${booking.id}')" ${!canModify ? 'disabled style="opacity: 0.5; cursor: not-allowed;"' : ''}>Reschedule</button>
                <button class="btn btn-danger" onclick="cancelBooking('${booking.id}')" ${!canModify ? 'disabled style="opacity: 0.5; cursor: not-allowed;"' : ''}>Cancel</button>
            </div>
        </div>
    `;
    }).join('');
}

// Cancel booking
function cancelBooking(bookingId) {
    const booking = bookings.find(b => b.id === bookingId);
    
    if (!canModifyBooking(booking)) {
        showCustomAlert('Sorry, you cannot cancel this booking. Cancellations must be made at least 30 minutes before the start time.', 'error');
        return;
    }
    
    showCustomConfirm('Are you sure you want to cancel this booking?', () => {
        bookings = bookings.filter(b => b.id !== bookingId);
        saveData();
        renderSchedule();
        renderMyBookings();
        showCustomAlert('Booking cancelled successfully!', 'success');
    });
}

// Open reschedule modal
function openRescheduleModal(bookingId) {
    selectedBooking = bookings.find(b => b.id === bookingId);
    
    if (!canModifyBooking(selectedBooking)) {
        showCustomAlert('Sorry, you cannot reschedule this booking. Changes must be made at least 30 minutes before the start time.', 'error');
        return;
    }
    
    // Populate machines
    const machineSelect = document.getElementById('rescheduleMachine');
    machineSelect.innerHTML = machines.map(m => 
        `<option value="${m}" ${m === selectedBooking.machine ? 'selected' : ''}>${m}</option>`
    ).join('');

    // Set date
    document.getElementById('rescheduleDate').value = getTodayDate();
    document.getElementById('rescheduleDate').min = getTodayDate();

    // Populate times
    updateRescheduleTimeSlots();

    document.getElementById('rescheduleModal').style.display = 'flex';
}

function closeRescheduleModal() {
    document.getElementById('rescheduleModal').style.display = 'none';
    selectedBooking = null;
}

function updateRescheduleTimeSlots() {
    const machine = document.getElementById('rescheduleMachine').value;
    const date = document.getElementById('rescheduleDate').value;
    const timeSelect = document.getElementById('rescheduleTime');

    // Re-populate machines dropdown with current machines list
    const machineSelect = document.getElementById('rescheduleMachine');
    machineSelect.innerHTML = machines.map(m => 
        `<option value="${m}" ${m === selectedBooking.machine ? 'selected' : ''}>${m}</option>`
    ).join('');

    const availableSlots = timeSlots.filter(time => {
        // Check if slot is already booked
        const isAlreadyBooked = bookings.some(b => 
            b.machine === machine && 
            b.time === time && 
            b.date === date &&
            b.id !== selectedBooking.id
        );
        
        if (isAlreadyBooked) return false;
        
        // Check if user has reached their limit for this machine type
        if (selectedBooking.userId === currentUser.studentId) {
            const userId = currentUser.studentId;
            
            if (isMachineWasher(machine) && machine !== selectedBooking.machine) {
                const userWasherBookings = bookings.filter(b => 
                    b.userId === userId && 
                    b.date === date &&
                    washers.includes(b.machine) &&
                    b.id !== selectedBooking.id
                );
                
                if (userWasherBookings.length >= 2) return false;
            }
            
            if (isMachineDryer(machine) && machine !== selectedBooking.machine) {
                const userDryerBookings = bookings.filter(b => 
                    b.userId === userId && 
                    b.date === date &&
                    dryers.includes(b.machine) &&
                    b.id !== selectedBooking.id
                );
                
                if (userDryerBookings.length >= 2) return false;
            }
        }
        
        return true;
    });

    timeSelect.innerHTML = availableSlots.map(time => 
        `<option value="${time}" ${time === selectedBooking.time ? 'selected' : ''}>${time}</option>`
    ).join('');
}

// Update event listener for new machine type change
document.addEventListener('DOMContentLoaded', function() {
    const rescheduleMachine = document.getElementById('rescheduleMachine');
    const rescheduleDate = document.getElementById('rescheduleDate');
    const newMachineType = document.getElementById('newMachineType');
    
    if (rescheduleMachine) {
        rescheduleMachine.addEventListener('change', updateRescheduleTimeSlots);
    }
    if (rescheduleDate) {
        rescheduleDate.addEventListener('change', updateRescheduleTimeSlots);
    }
    if (newMachineType) {
        newMachineType.addEventListener('change', function() {
            const nextNumber = getNextMachineNumber(this.value);
            document.getElementById('newMachineNumber').value = nextNumber;
        });
    }
    
    // Check authentication on page load
    checkAuth();
});
// EmailJS configuration
function sendReminderEmail(booking, userEmail) {
    console.log("Sending reminder to", userEmail);
    emailjs.send("service_e8vg3h8", "template_hgt6pkh", {
        to_email: userEmail,
        machine: booking.machine,
        date: booking.date,
        time: booking.time,
        
    })
    
    .then(() => {
        console.log("Reminder sent to", userEmail);
        booking.reminderSent = true; // Prevent duplicate emails
        saveData();
    })
    .catch((err) => {
        console.error("EmailJS Error:", err);
        alert("EmailJS Error: " + JSON.stringify(err));
    });
}


// Update the auto-refresh function
setInterval(() => {
    if (!currentUser) return;

    // Refresh UI
    if (currentUser.role === 'admin') {
        renderAdminBookings();
    } else {
        renderSchedule();
        renderMyBookings();
    }
    console.log("check")
    checkForUpcomingReminders();

}, 60000); // run every 1 minute

function checkForUpcomingReminders() {
    const now = new Date();
    console.log(" REMINDER CHECK at:", now.toLocaleString());
    console.log("Total bookings to check:", bookings.length);
    
    let remindersSent = 0;
    
    // If no bookings, exit early
    if (bookings.length === 0) {
        console.log("No bookings to check");
        return;
    }
    
    bookings.forEach(booking => {
        // Skip if reminder already sent - IMPORTANT: check the actual property
        if (booking.reminderSent === true) {
            console.log(`⏭ Skipping ${booking.id} - reminder already sent`);
            return;
        }
        
        console.log(` Processing booking ${booking.id}:`);
        console.log(`   Machine: ${booking.machine}`);
        console.log(`   Date: ${booking.date}`);
        console.log(`   Time: ${booking.time}`);
        console.log(`   Reminder sent flag: ${booking.reminderSent || false}`);
        
        try {
            // Parse the time slot (e.g., "13:00 - 14:00")
            const [startTimeStr] = booking.time.split(" - ");
            
            // IMPORTANT: Create date string in correct format for your timezone
            // The issue might be that booking.date is in format "YYYY-MM-DD"
            // We need to combine it with the time
            const dateTimeStr = `${booking.date}T${startTimeStr}:00`;
            const bookingDateTime = new Date(dateTimeStr);
            
            // Validate the date
            if (isNaN(bookingDateTime.getTime())) {
                console.error(`    INVALID DATE: ${dateTimeStr}`);
                return;
            }
            
            // Calculate difference in minutes
            const diffMs = bookingDateTime.getTime() - now.getTime();
            const diffMinutes = diffMs / (1000 * 60);
            
            console.log(`   Time until booking: ${Math.round(diffMinutes)} minutes`);
            console.log(`   Booking time (local): ${bookingDateTime.toLocaleString()}`);
            console.log(`   Current time: ${now.toLocaleString()}`);
            
            // CHANGE: Send reminder 60 minutes (1 hour) before
            // Changed from 30 minutes to 60 minutes as requested
            if (diffMinutes <= 60 && diffMinutes >= 0) {
                const user = users.find(u => u.studentId === booking.userId);
                if (user && user.email) {
                    console.log(`    SENDING REMINDER to ${user.email}`);
                    console.log(`    ${Math.round(diffMinutes)} minutes before booking`);
                    
                    // Send the email
                    sendReminderEmail(booking, user.email);
                    remindersSent++;
                } else {
                    console.warn(`    No user/email found for booking`);
                }
            } else if (diffMinutes < 0) {
                console.log(`    Booking started ${Math.abs(Math.round(diffMinutes))} minutes ago`);
            } else {
                console.log(`    ${Math.round(diffMinutes)} minutes until reminder window (needs to be ≤60)`);
            }
            
        } catch (error) {
            console.error(`    Error processing booking:`, error);
        }
        console.log("---"); // Separator
    });
    
    if (remindersSent > 0) {
        console.log(` SUCCESS: Sent ${remindersSent} reminder(s)`);
        // saveData() is called inside sendReminderEmail
    } else {
        console.log(`ℹ No reminders were sent this time`);
    }
}

// Also update the sendReminderEmail function slightly:
function sendReminderEmail(booking, userEmail) {
    console.log(" Sending reminder to", userEmail);
    emailjs.send("service_e8vg3h8", "template_hgt6pkh", {
        to_email: userEmail,
        machine: booking.machine,
        date: booking.date,
        time: booking.time,
    })
    .then(() => {
        console.log(" Reminder sent to", userEmail);
        booking.reminderSent = true; // Mark as sent
        saveData(); // Save the change
    })
    .catch((err) => {
        console.error(" EmailJS Error:", err);
        // Don't use alert here - it's annoying for users
    });
}



// Confirm reschedule
function confirmReschedule() {
    const machine = document.getElementById('rescheduleMachine').value;
    const date = document.getElementById('rescheduleDate').value;
    const time = document.getElementById('rescheduleTime').value;

    const userId = currentUser.studentId;

    const originalWasWasher = isMachineWasher(selectedBooking.machine);
    const originalWasDryer = isMachineDryer(selectedBooking.machine);
    const newIsWasher = isMachineWasher(machine);
    const newIsDryer = isMachineDryer(machine);
    
    if ((originalWasWasher && newIsDryer) || (originalWasDryer && newIsWasher)) {
        // Changing machine type - check if user has reached limit for new type
        if (newIsWasher) {
            const userWasherBookings = bookings.filter(b => 
                b.userId === userId && 
                b.date === date &&
                washers.includes(b.machine) &&
                b.id !== selectedBooking.id
            );
            
            if (userWasherBookings.length >= 2) {
                showCustomAlert('You are only permitted to book 2 washer slots per day.', 'error');
                return;
            }
        }
        
        if (newIsDryer) {
            const userDryerBookings = bookings.filter(b => 
                b.userId === userId && 
                b.date === date &&
                dryers.includes(b.machine) &&
                b.id !== selectedBooking.id
            );
            
            if (userDryerBookings.length >= 2) {
                showCustomAlert('You are only permitted to book 2 dryer slots per day.', 'error');
                return;
            }
        }
    }

    const booking = bookings.find(b => b.id === selectedBooking.id);
    booking.machine = machine;
    booking.date = date;
    booking.time = time;

    saveData();
    closeRescheduleModal();
    renderSchedule();
    renderMyBookings();
    showCustomAlert('Booking rescheduled successfully!', 'success');
}

// Render admin bookings
function renderAdminBookings() {
    const tbody = document.getElementById('adminBookingsTable');
    if (!tbody) return;
    
    console.log('Rendering admin bookings. Total:', bookings.length);
    console.log('All bookings:', bookings);
    
    if (bookings.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7">
                    <div class="empty-state">
                        <h3>No Bookings Yet</h3>
                        <p>Bookings will appear here once students make reservations</p>
                    </div>
                </td>
            </tr>
        `;
        return;
    }

    // Sort bookings by date and time
    const sortedBookings = [...bookings].sort((a, b) => {
        if (a.date !== b.date) {
            return a.date.localeCompare(b.date);
        }
        return a.time.localeCompare(b.time);
    });

    tbody.innerHTML = sortedBookings.map(booking => {
        const status = 'Active';
        const statusClass = 'status-active';

        return `
            <tr>
                <td>${booking.userName}</td>
                <td>${booking.userId}</td>
                <td>${booking.machine}</td>
                <td>${booking.date}</td>
                <td>${booking.time}</td>
                <td><span class="status-badge ${statusClass}">${status}</span></td>
                <td>
                    <button class="btn btn-danger" style="padding: 6px 12px; font-size: 14px; width: auto;" onclick="adminCancelBooking('${booking.id}')">Cancel</button>
                </td>
            </tr>
        `;
    }).join('');
}

// Admin cancel booking
function adminCancelBooking(bookingId) {
    showCustomConfirm('Are you sure you want to cancel this booking?', () => {
        bookings = bookings.filter(b => b.id !== bookingId);
        saveData();
        renderAdminBookings();
        showCustomAlert('Booking cancelled successfully!', 'success');
    });
}

function countUserBookings(type, userEmail) {
    return bookings.filter(
        booking => booking.type === type && booking.email === userEmail
    ).length;
}

// Initialize - load saved bookings
console.log('Initialized. Total bookings:', bookings.length);

// Custom Alert Function
function showCustomAlert(message, type = 'info') {
    const alertDiv = document.createElement('div');
    alertDiv.className = 'custom-alert';
    
    let iconSvg = '';
    let alertClass = '';
    
    if (type === 'success') {
        alertClass = 'alert-success-custom';
        iconSvg = `<svg class="alert-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
            <polyline points="22 4 12 14.01 9 11.01"></polyline>
        </svg>`;
    } else if (type === 'error') {
        alertClass = 'alert-error-custom';
        iconSvg = `<svg class="alert-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="15" y1="9" x2="9" y2="15"></line>
            <line x1="9" y1="9" x2="15" y2="15"></line>
        </svg>`;
    } else {
        alertClass = 'alert-info-custom';
        iconSvg = `<svg class="alert-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="16" x2="12" y2="12"></line>
            <line x1="12" y1="8" x2="12.01" y2="8"></line>
        </svg>`;
    }
    
    alertDiv.innerHTML = `
        <div class="custom-alert-content ${alertClass}">
            <div class="alert-header">
                ${iconSvg}
                <h3 class="alert-title">${type === 'success' ? 'Success' : type === 'error' ? 'Error' : 'Info'}</h3>
            </div>
            <p class="alert-message">${message}</p>
            <button class="btn btn-primary alert-btn" onclick="this.closest('.custom-alert').remove()">OK</button>
        </div>
    `;
    document.body.appendChild(alertDiv);
    
    // Auto-focus the OK button
    setTimeout(() => {
        alertDiv.querySelector('button').focus();
    }, 100);
}

// Custom Confirm Function
function showCustomConfirm(message, onConfirm) {
    const confirmDiv = document.createElement('div');
    confirmDiv.className = 'custom-alert';
    confirmDiv.innerHTML = `
        <div class="custom-alert-content">
            <p>${message}</p>
            <div style="display: flex; gap: 10px; margin-top: 20px;">
                <button class="btn btn-primary" style="flex: 1;" onclick="this.closest('.custom-alert').remove(); (${onConfirm})()">Confirm</button>
                <button class="btn btn-secondary" style="flex: 1;" onclick="this.closest('.custom-alert').remove()">Cancel</button>
            </div>
        </div>
    `;
    document.body.appendChild(confirmDiv);
    
    // Store the callback function
    confirmDiv.querySelector('.btn-primary').onclick = function() {
        confirmDiv.remove();
        onConfirm();
    };
    
    confirmDiv.querySelector('.btn-secondary').onclick = function() {
        confirmDiv.remove();
    };
    
    // Auto-focus the Cancel button for safety
    setTimeout(() => {
        confirmDiv.querySelector('.btn-secondary').focus();
    }, 100);
}
