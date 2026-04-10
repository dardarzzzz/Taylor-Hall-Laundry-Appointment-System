// =============================================================================
// CONFIG
// =============================================================================
const SUPABASE_URL = 'https://klyqajuflgrbhwuczecu.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtseXFhanVmbGdyYmh3dWN6ZWN1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ3NzA1NjQsImV4cCI6MjA5MDM0NjU2NH0.XbVgtFG7TM1iQCgN_yYawhF13tPPRZoz-y1C5UT_g60';

const TIME_SLOTS = [
    '08:00 - 09:00', '09:00 - 10:00', '10:00 - 11:00', '11:00 - 12:00',
    '12:00 - 13:00', '13:00 - 14:00', '14:00 - 15:00', '15:00 - 16:00',
    '16:00 - 17:00', '17:00 - 18:00', '18:00 - 19:00', '19:00 - 20:00'
];

var supabase; // initialised in DOMContentLoaded


// =============================================================================
// DOMAIN MODELS
// Plain classes that represent the core "things" in the system.
// They hold data and provide simple behaviour about themselves.
// =============================================================================

/**
 * Represents a logged-in user.
 * Encapsulates identity and role so the rest of the code never
 * has to poke at raw properties to answer "is this an admin?".
 */
class User {
    constructor({ id, name, email, studentId, role }) {
        this.id        = id;
        this.name      = name;
        this.email     = email;
        this.studentId = studentId;
        this.role      = role;
    }

    isAdmin() { return this.role === 'admin'; }

    /** Serialise to plain object for sessionStorage */
    toJSON() {
        return { id: this.id, name: this.name, email: this.email,
                 studentId: this.studentId, role: this.role };
    }

    /** Rehydrate from sessionStorage */
    static fromJSON(obj) { return new User(obj); }
}

/**
 * Represents a single laundry booking.
 * Knows how to answer time-related questions about itself.
 */
class Booking {
    constructor({ id, userId, userName, machine, date, time, reminderSent, createdAt, userAuthId }) {
        this.id           = id;
        this.userId       = userId;
        this.userName     = userName;
        this.machine      = machine;
        this.date         = date;
        this.time         = time;
        this.reminderSent = reminderSent;
        this.createdAt    = createdAt;
        this.userAuthId   = userAuthId;
    }

    /** True if the booking start is still ≥ 30 min away */
    canModify() {
        const startTime = new Date(`${this.date}T${this.time.split(' - ')[0]}:00`);
        return (startTime - new Date()) / (1000 * 60) >= 30;
    }

    /** Human-readable countdown string */
    timeUntil() {
        const startTime   = new Date(`${this.date}T${this.time.split(' - ')[0]}:00`);
        const minutesDiff = Math.floor((startTime - new Date()) / (1000 * 60));
        if (minutesDiff < 0)  return 'Started';
        if (minutesDiff < 60) return `${minutesDiff} min`;
        return `${Math.floor(minutesDiff / 60)}h ${minutesDiff % 60}m`;
    }

    /** True when the slot is within the 60-min reminder window */
    needsReminder() {
        if (this.reminderSent) return false;
        const startTime   = new Date(`${this.date}T${this.time.split(' - ')[0]}:00`);
        const diffMinutes = (startTime - new Date()) / (1000 * 60);
        return diffMinutes <= 60 && diffMinutes >= 0;
    }

    /** Map a raw Supabase DB row → Booking instance */
    static fromDB(row) {
        return new Booking({
            id:           row.id,
            userId:       row.student_id,
            userName:     row.user_name,
            machine:      row.machine_name,
            date:         row.date,
            time:         row.time_slot,
            reminderSent: row.reminder_sent,
            createdAt:    row.created_at,
            userAuthId:   row.user_id
        });
    }
}

/**
 * Represents a laundry machine.
 * Knows its own type and how to generate a display name.
 */
class Machine {
    constructor({ name, type }) {
        this.name = name;
        this.type = type; // 'washer' | 'dryer'
    }

    isWasher() { return this.type === 'washer'; }
    isDryer()  { return this.type === 'dryer';  }

    static fromDB(row) { return new Machine({ name: row.name, type: row.type }); }

    static generateName(type, number) {
        return `${type === 'washer' ? 'Washer' : 'Dryer'} ${number}`;
    }
}


// =============================================================================
// SERVICE CLASSES
// Each service owns one slice of the application's data and all database
// calls for that slice.  No service touches the DOM.
// =============================================================================

/**
 * AuthService — sign-up, login, logout, session persistence.
 * Single Responsibility: everything auth-related lives here.
 */
class AuthService {
    constructor(supabaseClient) {
        this._db = supabaseClient;
    }

    /** Try to restore a session from sessionStorage */
    restoreSession() {
        const raw = sessionStorage.getItem('currentUser');
        return raw ? User.fromJSON(JSON.parse(raw)) : null;
    }

    _saveSession(user) {
        sessionStorage.setItem('currentUser', JSON.stringify(user.toJSON()));
    }

    async login(emailOrId, password) {
        // Check if login fields are filled
        if (!emailOrId || !password) throw new Error('Please enter your email/ID and password.');

        let email = emailOrId;
        // If input is a student ID, look up the corresponding email
        if (!emailOrId.includes('@')) {
            // Authenticate user with email and password
            const { data: row } = await this._db.from('users').select('email')
                .eq('student_id', emailOrId).single();
            if (!row) throw new Error('No account found with that Student ID.');
            email = row.email;
        }

        const { data, error } = await this._db.auth.signInWithPassword({ email, password });
        if (error) throw new Error('Invalid credentials! Please check your email/ID and password.');
            // Fetch full user profile from databas
        const { data: profile } = await this._db.from('users').select('*')
            .eq('id', data.user.id).single();
        if (!profile) throw new Error('Account profile not found.');
        // Create User object from profile data
        const user = new User({
            id:        profile.id,
            name:      profile.name,
            email:     profile.email,
            studentId: profile.student_id,
            role:      profile.role
        });
        // Save user session locally
        this._saveSession(user);
        return user;
    }
    // Register a new user
    async signup({ name, email, studentId, password }) {
        if (!name || !email || !studentId || !password)
            throw new Error('Please fill in all fields!');

        const { data: existing } = await this._db.from('users').select('id')
            .or(`email.eq.${email},student_id.eq.${studentId}`).maybeSingle();
        if (existing) throw new Error('An account with that email or Student ID already exists.');
          // Create authentication account
        const { data, error } = await this._db.auth.signUp({ email, password });
        if (error) throw new Error(error.message);
        // Insert user profile into database
        const { error: profileError } = await this._db.from('users').insert({
            id: data.user.id, name, email, student_id: studentId, role: 'user'
        });
        if (profileError) throw new Error('Error creating profile: ' + profileError.message);
    }
    // Log out user and clear session
    async logout() {
        await this._db.auth.signOut();
        sessionStorage.removeItem('currentUser');
    }
}

/**
 * MachineService — loads, adds, and removes machines.
 * Encapsulates the machines array and all related DB calls.
 */
class MachineService {
    constructor(supabaseClient) {
        this._db    = supabaseClient;
        this._items = []; // Machine[]
    }

    get all()     { return this._items; }
    get washers() { return this._items.filter(m => m.isWasher()); }
    get dryers()  { return this._items.filter(m => m.isDryer());  }
    get names()   { return this._items.map(m => m.name); }

    isWasher(name) { return this.washers.some(m => m.name === name); }
    isDryer(name)  { return this.dryers.some(m => m.name === name);  }

    async load() {
        const { data, error } = await this._db.from('machines').select('*')
            .order('type').order('name');
        if (error) { console.error('Error loading machines:', error); return; }
        this._items = (data || []).map(Machine.fromDB);
    }

    getNextNumber(type) {
        const list    = type === 'washer' ? this.washers : this.dryers;
        const numbers = list.map(m => {
            const match = m.name.match(/(\d+)$/);
            return match ? parseInt(match[1]) : 0;
        });
        return numbers.length > 0 ? Math.max(...numbers) + 1 : 1;
    }

    async add(type, number) {
        const name = Machine.generateName(type, number);
        const alreadyExists = type === 'washer'
            ? this.washers.some(m => m.name === name)
            : this.dryers.some(m => m.name === name);

        if (alreadyExists) throw new Error(`${name} already exists!`);

        const { error } = await this._db.from('machines').insert({ name, type });
        if (error) throw new Error('Error adding machine: ' + error.message);

        await this.load();
        return name;
    }

    async remove(name) {
        // Delete all bookings for this machine first (cascade not guaranteed)
        await this._db.from('bookings').delete().eq('machine_name', name);
        const { error } = await this._db.from('machines').delete().eq('name', name);
        if (error) throw new Error('Error deleting machine: ' + error.message);
        await this.load();
    }
}

/**
 * BookingService — loads and mutates bookings.
 * Business rules (daily limits, modification window) live here.
 */
class BookingService {
    constructor(supabaseClient, machineService) {
        this._db       = supabaseClient;
        this._machines = machineService;
        this._items    = []; // Booking[]
    }

    get all() { return this._items; }

    async load() {
        const { data, error } = await this._db.from('bookings').select('*');
        if (error) { console.error('Error loading bookings:', error); return; }
        this._items = (data || []).map(Booking.fromDB);
    }

    forUser(studentId) {
        return this._items.filter(b => b.userId === studentId);
    }

    isSlotTaken(machine, date, time, excludeId = null) {
        return this._items.some(b =>
            b.machine === machine && b.time === time && b.date === date && b.id !== excludeId
        );
    }

    /** Count how many washer/dryer bookings a user has today */
    _countToday(userId, date, typeCheck, excludeId = null) {
        return this._items.filter(b =>
            b.userId === userId && b.date === date &&
            typeCheck(b.machine) && b.id !== excludeId
        ).length;
    }

    /**
     * Validate a booking attempt against the daily limit rules.
     * Throws a descriptive Error if a limit is exceeded.
     */
    validateLimits(userId, date, machine, excludeId = null) {
        if (this._machines.isWasher(machine)) {
            const count = this._countToday(userId, date, n => this._machines.isWasher(n), excludeId);
            if (count >= 2) throw new Error('You are only permitted to book 2 washer slots per day.');
        }
        if (this._machines.isDryer(machine)) {
            const count = this._countToday(userId, date, n => this._machines.isDryer(n), excludeId);
            if (count >= 2) throw new Error('You are only permitted to book 2 dryer slots per day.');
        }
    }

    async create(user, { machine, date, time }) {
        this.validateLimits(user.studentId, date, machine);

        const { error } = await this._db.from('bookings').insert({
            user_id:       user.id,
            machine_name:  machine,
            user_name:     user.name,
            student_id:    user.studentId,
            date,
            time_slot:     time,
            reminder_sent: false
        });

        if (error) {
            if (error.code === '23505') throw new Error('That slot was just taken! Please choose another.');
            throw new Error('Error creating booking: ' + error.message);
        }
        await this.load();
    }

    async cancel(bookingId) {
        const booking = this._items.find(b => b.id === bookingId);
        if (!booking) throw new Error('Booking not found.');
        if (!booking.canModify()) throw new Error('Cancellations must be made at least 30 minutes before the start time.');

        const { error } = await this._db.from('bookings').delete().eq('id', bookingId);
        if (error) throw new Error('Error cancelling booking.');
        await this.load();
    }

    async reschedule(bookingId, user, { machine, date, time }) {
        const booking = this._items.find(b => b.id === bookingId);
        if (!booking) throw new Error('Booking not found.');
        if (!booking.canModify()) throw new Error('Changes must be made at least 30 minutes before the start time.');

        // Only check limits when switching machine type
        const typeChanging = this._machines.isWasher(booking.machine) !== this._machines.isWasher(machine);
        if (typeChanging) {
            this.validateLimits(user.studentId, date, machine, bookingId);
        }

        const { error } = await this._db.from('bookings').update({
            machine_name:  machine,
            date,
            time_slot:     time,
            reminder_sent: false
        }).eq('id', bookingId);

        if (error) throw new Error('Error rescheduling: ' + error.message);
        await this.load();
    }

    async adminCancel(bookingId) {
        const { error } = await this._db.from('bookings').delete().eq('id', bookingId);
        if (error) throw new Error('Error cancelling booking.');
        await this.load();
    }

    /** Return available time slots for rescheduling a given booking */
    availableSlotsFor(machine, date, userId, excludeId) {
        return TIME_SLOTS.filter(time => {
            if (this.isSlotTaken(machine, date, time, excludeId)) return false;

            // Only enforce limits when the machine type would change
            const booking = this._items.find(b => b.id === excludeId);
            const typeChanging = booking
                ? this._machines.isWasher(booking.machine) !== this._machines.isWasher(machine)
                : false;

            if (typeChanging) {
                if (this._machines.isWasher(machine)) {
                    const count = this._countToday(userId, date, n => this._machines.isWasher(n), excludeId);
                    if (count >= 2) return false;
                }
                if (this._machines.isDryer(machine)) {
                    const count = this._countToday(userId, date, n => this._machines.isDryer(n), excludeId);
                    if (count >= 2) return false;
                }
            }
            return true;
        });
    }
}

/**
 * ReminderService — checks for upcoming bookings and sends email reminders.
 * Single Responsibility: reminder logic is completely isolated here.
 */
class ReminderService {
    constructor(supabaseClient, bookingService) {
        this._db       = supabaseClient;
        this._bookings = bookingService;
    }

    async checkAndSend() {
        console.log('REMINDER CHECK at:', new Date().toLocaleString());
        const pending = this._bookings.all.filter(b => b.needsReminder());
        for (const booking of pending) {
            try {
                const { data: userRow } = await this._db.from('users').select('email')
                    .eq('student_id', booking.userId).single();
                if (userRow?.email) await this._send(booking, userRow.email);
            } catch (err) {
                console.error('Error processing reminder:', err);
            }
        }
    }

    async _send(booking, userEmail) {
        console.log('Sending reminder to', userEmail);
        emailjs.send('service_e8vg3h8', 'template_hgt6pkh', {
            to_email: userEmail,
            machine:  booking.machine,
            date:     booking.date,
            time:     booking.time
        })
        .then(async () => {
            console.log('Reminder sent to', userEmail);
            await this._db.from('bookings').update({ reminder_sent: true }).eq('id', booking.id);
            await this._bookings.load();
        })
        .catch(err => console.error('EmailJS Error:', err));
    }
}


// =============================================================================
// UI HELPERS
// Stateless functions that interact with the DOM.
// Kept as plain functions (not a class) because they have no shared state —
// they simply produce or remove DOM nodes.
// =============================================================================

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

function getTodayDate() {
    return new Date().toISOString().split('T')[0];
}


// =============================================================================
// APP CONTROLLER
// Wires services together, owns the application lifecycle, and delegates
// rendering to the renderer.  No raw DB calls here — it only calls services.
// =============================================================================

class AppController {
    constructor() {
        this.authService    = null;
        this.machineService = null;
        this.bookingService = null;
        this.reminderService= null;
        this.renderer       = null;

        this.currentUser    = null;
        this.pendingBooking = null; // { machine, date, time }
        this.selectedBooking= null; // Booking being rescheduled
        this.machineToDelete= null; // { name, type }
    }

    /** Called once Supabase is ready */
    init(supabaseClient) {
        this.authService     = new AuthService(supabaseClient);
        this.machineService  = new MachineService(supabaseClient);
        this.bookingService  = new BookingService(supabaseClient, this.machineService);
        this.reminderService = new ReminderService(supabaseClient, this.bookingService);
        this.renderer        = new Renderer(this);
    }

    // ── Auth ─────────────────────────────────────────────────────────────────

    async checkAuth() {
        if (!window.location.pathname.includes('dashboard.html')) return;
        const user = this.authService.restoreSession();
        if (!user) { window.location.href = 'index.html'; return; }

        this.currentUser = user;
        await this.machineService.load();
        await this.bookingService.load();

        if (user.isAdmin()) {
            this.renderer.showAdminDashboard();
        } else {
            this.renderer.showUserDashboard();
        }

        // Auto-refresh every minute
        setInterval(async () => {
            await this.bookingService.load();
            if (this.currentUser.isAdmin()) {
                this.renderer.renderAdminBookings();
            } else {
                this.renderer.renderSchedule();
                this.renderer.renderMyBookings();
            }
            await this.reminderService.checkAndSend();
        }, 60000);
    }

    async login() {
        const emailOrId = document.getElementById('loginEmail').value.trim();
        const password  = document.getElementById('loginPassword').value;
        try {
            await this.authService.login(emailOrId, password);
            window.location.href = 'dashboard.html';
        } catch (err) {
            showCustomAlert(err.message, 'error');
        }
    }

    async signup() {
        const name      = document.getElementById('signupName').value.trim();
        const email     = document.getElementById('signupEmail').value.trim();
        const studentId = document.getElementById('signupStudentId').value.trim();
        const password  = document.getElementById('signupPassword').value;
        try {
            await this.authService.signup({ name, email, studentId, password });
            showCustomAlert('Account created successfully! Please login.', 'success');
            setTimeout(() => this.showLogin(), 1500);
        } catch (err) {
            showCustomAlert(err.message, 'error');
        }
    }

    async logout() {
        await this.authService.logout();
        window.location.href = 'index.html';
    }

    showLogin() {
        document.getElementById('loginForm').classList.remove('hidden');
        document.getElementById('signupForm').classList.add('hidden');
    }

    showSignup() {
        document.getElementById('signupForm').classList.remove('hidden');
        document.getElementById('loginForm').classList.add('hidden');
    }

    // ── Booking Modal ─────────────────────────────────────────────────────────

    openBookingModal(machine, date, time) {
        try {
            this.bookingService.validateLimits(this.currentUser.studentId, date, machine);
        } catch (err) {
            showCustomAlert(err.message, 'error');
            return;
        }
        this.pendingBooking = { machine, date, time };
        document.getElementById('modalMachine').textContent = machine;
        document.getElementById('modalDate').textContent    = date;
        document.getElementById('modalTime').textContent    = time;
        document.getElementById('bookingModal').style.display = 'flex';
    }

    closeModal() {
        document.getElementById('bookingModal').style.display = 'none';
        this.pendingBooking = null;
    }

    async confirmBooking() {
        if (!this.pendingBooking) return;
        try {
            await this.bookingService.create(this.currentUser, this.pendingBooking);
            this.closeModal();
            this.renderer.renderSchedule();
            this.renderer.renderMyBookings();
            showCustomAlert('Booking confirmed! Your Student ID is: ' + this.currentUser.studentId, 'success');
        } catch (err) {
            showCustomAlert(err.message, 'error');
        }
    }

    // ── Cancel / Reschedule ───────────────────────────────────────────────────

    cancelBooking(bookingId) {
        showCustomConfirm('Are you sure you want to cancel this booking?', async () => {
            try {
                await this.bookingService.cancel(bookingId);
                this.renderer.renderSchedule();
                this.renderer.renderMyBookings();
                showCustomAlert('Booking cancelled successfully!', 'success');
            } catch (err) {
                showCustomAlert(err.message, 'error');
            }
        });
    }

    openRescheduleModal(bookingId) {
        const booking = this.bookingService.all.find(b => b.id === bookingId);
        if (!booking.canModify()) {
            showCustomAlert('Changes must be made at least 30 minutes before the start time.', 'error');
            return;
        }
        this.selectedBooking = booking;
        const machineSelect  = document.getElementById('rescheduleMachine');
        machineSelect.innerHTML = this.machineService.names.map(m =>
            `<option value="${m}" ${m === booking.machine ? 'selected' : ''}>${m}</option>`
        ).join('');
        document.getElementById('rescheduleDate').value = getTodayDate();
        document.getElementById('rescheduleDate').min   = getTodayDate();
        this.updateRescheduleTimeSlots();
        document.getElementById('rescheduleModal').style.display = 'flex';
    }

    closeRescheduleModal() {
        document.getElementById('rescheduleModal').style.display = 'none';
        this.selectedBooking = null;
    }

    updateRescheduleTimeSlots() {
        const machine    = document.getElementById('rescheduleMachine').value;
        const date       = document.getElementById('rescheduleDate').value;
        const timeSelect = document.getElementById('rescheduleTime');

        // Re-populate machine list (keeps selection in sync)
        const machineSelect = document.getElementById('rescheduleMachine');
        machineSelect.innerHTML = this.machineService.names.map(m =>
            `<option value="${m}" ${m === this.selectedBooking.machine ? 'selected' : ''}>${m}</option>`
        ).join('');

        const slots = this.bookingService.availableSlotsFor(
            machine, date, this.currentUser.studentId, this.selectedBooking.id
        );
        timeSelect.innerHTML = slots.map(t =>
            `<option value="${t}" ${t === this.selectedBooking.time ? 'selected' : ''}>${t}</option>`
        ).join('');
    }

    async confirmReschedule() {
        const machine = document.getElementById('rescheduleMachine').value;
        const date    = document.getElementById('rescheduleDate').value;
        const time    = document.getElementById('rescheduleTime').value;
        try {
            await this.bookingService.reschedule(
                this.selectedBooking.id, this.currentUser, { machine, date, time }
            );
            this.closeRescheduleModal();
            this.renderer.renderSchedule();
            this.renderer.renderMyBookings();
            showCustomAlert('Booking rescheduled successfully!', 'success');
        } catch (err) {
            showCustomAlert(err.message, 'error');
        }
    }

    // ── Admin Actions ─────────────────────────────────────────────────────────

    adminCancelBooking(bookingId) {
        showCustomConfirm('Are you sure you want to cancel this booking?', async () => {
            try {
                await this.bookingService.adminCancel(bookingId);
                this.renderer.renderAdminBookings();
                showCustomAlert('Booking cancelled successfully!', 'success');
            } catch (err) {
                showCustomAlert(err.message, 'error');
            }
        });
    }

    async addNewMachine() {
        const type        = document.getElementById('newMachineType').value;
        const numberInput = document.getElementById('newMachineNumber').value;
        if (!type || !numberInput) { showCustomAlert('Please select a type and enter a number', 'error'); return; }
        const number = parseInt(numberInput);
        if (isNaN(number) || number < 1) { showCustomAlert('Please enter a valid number (minimum 1)', 'error'); return; }
        try {
            const name = await this.machineService.add(type, number);
            this.renderer.renderMachineList();
            showCustomAlert(`${name} added successfully!`, 'success');
            document.getElementById('newMachineNumber').value = this.machineService.getNextNumber(type);
        } catch (err) {
            showCustomAlert(err.message, 'error');
        }
    }

    promptDeleteMachine(machineName, machineType) {
        this.machineToDelete = { name: machineName, type: machineType };
        document.getElementById('deleteMachineName').textContent = machineName;
        document.getElementById('deleteMachineModal').style.display = 'flex';
    }

    async confirmDeleteMachine() {
        if (!this.machineToDelete) return;
        try {
            const { name } = this.machineToDelete;
            await this.machineService.remove(name);
            await this.bookingService.load();
            this.renderer.renderMachineList();
            this.renderer.renderSchedule();
            this.renderer.renderAdminBookings();
            this.closeDeleteModal();
            showCustomAlert(`${name} has been removed.`, 'success');
        } catch (err) {
            showCustomAlert(err.message, 'error');
        }
    }

    closeDeleteModal() {
        document.getElementById('deleteMachineModal').style.display = 'none';
        this.machineToDelete = null;
    }

    exportCSV() {
        const rows = document.querySelectorAll('#adminBookingsTable tr');
        let csv = 'Student Name,Student ID,Machine,Date,Time,Status\n';
        rows.forEach(row => {
            const cols    = row.querySelectorAll('td');
            const rowData = [...cols].map(col => col.innerText.replace(/,/g, ''));
            if (rowData.length > 1) csv += rowData.join(',') + '\n';
        });
        const a    = document.createElement('a');
        a.href     = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
        a.download = 'laundry-bookings.csv';
        a.click();
    }

    showTab(tab, clickedEl) {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        clickedEl.classList.add('active');
        if (tab === 'schedule') {
            document.getElementById('scheduleTab').classList.remove('hidden');
            document.getElementById('mybookingsTab').classList.add('hidden');
            this.renderer.renderSchedule();
        } else {
            document.getElementById('scheduleTab').classList.add('hidden');
            document.getElementById('mybookingsTab').classList.remove('hidden');
            this.renderer.renderMyBookings();
        }
    }

    showAdminTab(tab, clickedEl) {
        document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
        clickedEl.classList.add('active');
        document.querySelectorAll('.admin-content').forEach(c => c.classList.remove('active'));
        if (tab === 'bookings') {
            document.getElementById('adminBookingsTab').classList.add('active');
            this.renderer.renderAdminBookings();
        } else if (tab === 'machines') {
            document.getElementById('adminMachinesTab').classList.add('active');
            this.renderer.renderMachineList();
            const type = document.getElementById('newMachineType').value;
            document.getElementById('newMachineNumber').value = this.machineService.getNextNumber(type);
        }
    }
}


// =============================================================================
// RENDERER
// Responsible for building and updating DOM nodes.
// Reads data from services via the controller; never calls the DB itself.
// =============================================================================

class Renderer {
    constructor(controller) {
        this._ctrl = controller;
    }

    showUserDashboard() {
        document.getElementById('userDashboard').style.display = 'block';
        document.getElementById('adminDashboard').style.display = 'none';
        const user = this._ctrl.currentUser;
        document.getElementById('userName').textContent      = user.name;
        document.getElementById('userStudentId').textContent = user.studentId;
        this.renderSchedule();
        this.renderMyBookings();
    }

    showAdminDashboard() {
        document.getElementById('adminDashboard').style.display = 'block';
        document.getElementById('userDashboard').style.display  = 'none';
        this.renderAdminBookings();
        this.renderMachineList();
    }

    renderSchedule() {
        const grid = document.getElementById('scheduleGrid');
        if (!grid) return;
        grid.innerHTML = '';
        const today    = getTodayDate();
        const { bookingService: bs, machineService: ms, currentUser } = this._ctrl;

        ms.names.forEach(machine => {
            const card = document.createElement('div');
            card.className = 'machine-card';
            card.innerHTML = `<h3>${machine}</h3>`;

            TIME_SLOTS.forEach(time => {
                const booking = bs.all.find(b => b.machine === machine && b.time === time && b.date === today);
                const slot    = document.createElement('div');
                slot.className = 'time-slot';

                if (booking) {
                    if (booking.userId === currentUser.studentId) {
                        slot.className += ' my-booking';
                        slot.innerHTML  = `<span>${time}</span><span>Your Booking</span>`;
                    } else {
                        slot.className += ' booked';
                        slot.innerHTML  = `<span>${time}</span><span>Booked</span>`;
                    }
                } else {
                    slot.className += ' available';
                    slot.innerHTML  = `<span>${time}</span><span>Available</span>`;
                    slot.onclick    = () => this._ctrl.openBookingModal(machine, today, time);
                }
                card.appendChild(slot);
            });
            grid.appendChild(card);
        });
    }

    renderMyBookings() {
        const container = document.getElementById('myBookingsList');
        if (!container) return;
        const myBookings = this._ctrl.bookingService.forUser(this._ctrl.currentUser.studentId);

        if (myBookings.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <h3>No Bookings Yet</h3>
                    <p>Book a time slot from the "Available Machines" tab to get started!</p>
                </div>`;
            return;
        }

        container.innerHTML = myBookings.map(booking => {
            const canModify = booking.canModify();
            const timeUntil = booking.timeUntil();
            const isPast    = timeUntil === 'Started';
            return `
            <div class="booking-card">
                <h3>${booking.machine}</h3>
                <p><strong>Date:</strong> ${booking.date}</p>
                <p><strong>Time:</strong> ${booking.time}</p>
                <p><strong>Your ID:</strong> ${booking.userId}</p>
                ${!isPast ? `<p><strong>Starts in:</strong> ${timeUntil}</p>` : '<p><strong>Status:</strong> In Progress/Completed</p>'}
                <div style="display:flex;gap:10px;margin-top:15px;">
                    <button class="btn btn-secondary" onclick="app.openRescheduleModal('${booking.id}')"
                        ${!canModify ? 'disabled style="opacity:0.5;cursor:not-allowed;"' : ''}>Reschedule</button>
                    <button class="btn btn-danger"  onclick="app.cancelBooking('${booking.id}')"
                        ${!canModify ? 'disabled style="opacity:0.5;cursor:not-allowed;"' : ''}>Cancel</button>
                </div>
            </div>`;
        }).join('');
    }

    renderAdminBookings() {
        const tbody = document.getElementById('adminBookingsTable');
        if (!tbody) return;
        const all = this._ctrl.bookingService.all;

        if (all.length === 0) {
            tbody.innerHTML = `
                <tr><td colspan="7">
                    <div class="empty-state">
                        <h3>No Bookings Yet</h3>
                        <p>Bookings will appear here once students make reservations</p>
                    </div>
                </td></tr>`;
            return;
        }

        const sorted = [...all].sort((a, b) =>
            a.date !== b.date ? a.date.localeCompare(b.date) : a.time.localeCompare(b.time)
        );

        tbody.innerHTML = sorted.map(b => `
            <tr>
                <td>${b.userName}</td>
                <td>${b.userId}</td>
                <td>${b.machine}</td>
                <td>${b.date}</td>
                <td>${b.time}</td>
                <td><span class="status-badge status-active">Active</span></td>
                <td>
                    <button class="btn btn-danger" style="padding:6px 12px;font-size:14px;width:auto;"
                        onclick="app.adminCancelBooking('${b.id}')">Cancel</button>
                </td>
            </tr>`
        ).join('');
    }

    renderMachineList() {
        const machinesList = document.getElementById('machinesList');
        if (!machinesList) return;

        const allMachines = [...this._ctrl.machineService.all].sort((a, b) => {
            if (a.type !== b.type) return a.isWasher() ? -1 : 1;
            return parseInt(a.name.match(/(\d+)$/)[1]) - parseInt(b.name.match(/(\d+)$/)[1]);
        });

        machinesList.innerHTML = allMachines.map(machine => `
            <div class="machine-item">
                <span class="machine-type ${machine.type}">${machine.type.toUpperCase()}</span>
                <h4>${machine.name}</h4>
                <p>Type: ${machine.isWasher() ? 'Washer' : 'Dryer'}</p>
                <div style="margin-top:10px;">
                    <button class="btn btn-danger" onclick="app.promptDeleteMachine('${machine.name}','${machine.type}')"
                            style="padding:6px 12px;font-size:14px;">Remove</button>
                </div>
            </div>`
        ).join('');
    }
}


// =============================================================================
// GLOBAL INSTANCE
// One controller governs the whole page.  HTML onclick="" attributes call
// methods on this object, keeping the global namespace clean.
// =============================================================================
const app = new AppController();


// =============================================================================
// BOOTSTRAP
// =============================================================================
window.addEventListener('load', function () {
    if (window.emailjs) {
        emailjs.init('0onfjDexOAZW5TUlp');
        console.log('EmailJS initialized');
    } else {
        console.error('EmailJS failed to load!');
    }
});

document.addEventListener('DOMContentLoaded', function () {
    supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    app.init(supabase);

    // ── index.html bindings ───────────────────────────────────────────────────
    const loginBtn     = document.getElementById('loginBtn');
    const signupBtn    = document.getElementById('signupBtn');
    const showSignupBtn= document.getElementById('showSignupBtn');
    const showLoginBtn = document.getElementById('showLoginBtn');

    if (loginBtn)     loginBtn.addEventListener('click', () => app.login());
    if (signupBtn)    signupBtn.addEventListener('click', () => app.signup());
    if (showSignupBtn)showSignupBtn.addEventListener('click', () => app.showSignup());
    if (showLoginBtn) showLoginBtn.addEventListener('click', () => app.showLogin());

    const loginPassword  = document.getElementById('loginPassword');
    const signupPassword = document.getElementById('signupPassword');
    if (loginPassword)  loginPassword.addEventListener('keydown',  e => { if (e.key === 'Enter') app.login(); });
    if (signupPassword) signupPassword.addEventListener('keydown', e => { if (e.key === 'Enter') app.signup(); });

    // ── dashboard.html bindings ───────────────────────────────────────────────
    const rescheduleMachine = document.getElementById('rescheduleMachine');
    const rescheduleDate    = document.getElementById('rescheduleDate');
    const newMachineType    = document.getElementById('newMachineType');

    if (rescheduleMachine) rescheduleMachine.addEventListener('change', () => app.updateRescheduleTimeSlots());
    if (rescheduleDate)    rescheduleDate.addEventListener('change',    () => app.updateRescheduleTimeSlots());
    if (newMachineType) {
        newMachineType.addEventListener('change', function () {
            document.getElementById('newMachineNumber').value = app.machineService.getNextNumber(this.value);
        });
    }

    app.checkAuth();
});


// =============================================================================
// GLOBAL SHIMS
// dashboard.html uses inline onclick="" attributes that call bare function
// names.  These shims forward those calls to the app controller so the HTML
// does not need to change.
// =============================================================================
function logout()                               { app.logout(); }
function confirmBooking()                       { app.confirmBooking(); }
function closeModal()                           { app.closeModal(); }
function confirmReschedule()                    { app.confirmReschedule(); }
function closeRescheduleModal()                 { app.closeRescheduleModal(); }
function confirmDeleteMachine()                 { app.confirmDeleteMachine(); }
function closeDeleteModal()                     { app.closeDeleteModal(); }
function exportCSV()                            { app.exportCSV(); }
function addNewMachine()                        { app.addNewMachine(); }
function showTab(tab)                           { app.showTab(tab, event.target); }
function showAdminTab(tab)                      { app.showAdminTab(tab, event.target); }
