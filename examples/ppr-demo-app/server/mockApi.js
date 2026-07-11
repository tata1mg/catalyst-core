// Backing "APIs" for the demo pages. Real HTTP endpoints (not in-process fake
// promises) so PPR/static data fetching shows up as actual network calls —
// visible in server logs, curl-able independently of any page, and fetched
// the same way client-side (clientFetcher/refetch) as server-side.

const CUSTOMERS = ["Aarav Mehta", "Priya Nair", "Rohan Gupta", "Sneha Iyer", "Karan Malhotra", "Divya Rao"]
const PRODUCTS = [
    "Vitamin C Tablets",
    "Digital BP Monitor",
    "Whey Protein 1kg",
    "N95 Masks (10pk)",
    "Immunity Booster Kit",
]
const STATUSES = ["Delivered", "Pending", "Cancelled"]
const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

const QUEUE_ITEMS = [
    "Margherita Pizza",
    "Chicken Biryani",
    "Paneer Butter Masala",
    "Cold Coffee",
    "Veg Momos",
    "Butter Naan x4",
]
const QUEUE_STATUSES = ["Preparing", "Out for delivery", "Delivered"]
const RIDERS = ["Vikram", "Anjali", "Suresh", "Meena", "Rahul"]

function randomBetween(min, max) {
    return Math.random() * (max - min) + min
}

function pick(list) {
    return list[Math.floor(Math.random() * list.length)]
}

export function getGreeting(req, res) {
    setTimeout(() => {
        res.json({ servedAt: new Date().toISOString() })
    }, 150)
}

export function getLiveOrderStats(req, res) {
    setTimeout(() => {
        res.json({
            orderCount: Math.floor(Math.random() * 10000),
            fetchedAt: new Date().toISOString(),
        })
    }, 3000)
}

export function getDashboardSummary(req, res) {
    setTimeout(() => {
        res.json({
            revenue: randomBetween(3.1, 5.4).toFixed(2),
            revenueDelta: randomBetween(-4, 18).toFixed(1),
            orders: Math.floor(randomBetween(820, 2100)),
            ordersDelta: randomBetween(-6, 14).toFixed(1),
            conversionRate: randomBetween(2.1, 4.6).toFixed(1),
            activeUsers: Math.floor(randomBetween(60, 340)),
            weeklyChart: DAY_LABELS.map(() => Math.floor(randomBetween(20, 100))),
            recentOrders: Array.from({ length: 5 }, (_, i) => ({
                id: `#ORD-${8341 + i}`,
                customer: pick(CUSTOMERS),
                product: pick(PRODUCTS),
                amount: Math.floor(randomBetween(299, 4200)),
                status: pick(STATUSES),
            })),
        })
    }, 3000)
}

export function getLiveOrdersFeed(req, res) {
    setTimeout(() => {
        res.json({
            fetchedAt: new Date().toISOString(),
            queueLength: Math.floor(randomBetween(6, 34)),
            avgPrepTimeMins: Math.floor(randomBetween(9, 22)),
            activeRiders: Math.floor(randomBetween(3, 12)),
            ordersPerHour: Math.floor(randomBetween(18, 60)),
            queue: Array.from({ length: 6 }, (_, i) => ({
                id: `#KOT-${5210 + i}`,
                item: pick(QUEUE_ITEMS),
                customer: pick(CUSTOMERS),
                rider: pick(RIDERS),
                status: pick(QUEUE_STATUSES),
                etaMins: Math.floor(randomBetween(2, 35)),
            })),
        })
    }, 3000)
}

export function getPricingInfo(req, res) {
    res.json({
        generatedAt: new Date().toISOString(),
        buildId: Math.random().toString(36).slice(2, 10),
    })
}
