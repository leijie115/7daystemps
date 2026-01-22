
const fs = require('fs');

async function debug() {
    const daysZh = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    const daysEn = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    console.log('--- Debugging Date Logic ---');
    console.log('System Time:', new Date().toISOString());

    for (let i = 0; i < 7; i++) {
        const date = new Date();
        date.setDate(date.getDate() + i);

        const dayIndex = date.getDay();
        const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');

        console.log(`i=${i} | Date=${date.toISOString().slice(0, 10)} | Weekday=${daysEn[dayIndex]} (${dayIndex}) | Folder=${dateStr}`);
    }
}

debug();
