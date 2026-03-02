const express = require('express');
const mysql = require('mysql2');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const session = require('express-session');
const path = require('path');

// Load environment variables from .env (user should create .env with SUPABASE_URL and SUPABASE_KEY)
require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_KEY || '';

let supabase = null;
if (SUPABASE_URL && SUPABASE_KEY) {
    let sanitizedUrl = SUPABASE_URL;
    // if the user forgot protocol, add https:// automatically
    if (!/^https?:\/\//i.test(sanitizedUrl)) {
        console.warn('Supabase client initialization warning: SUPABASE_URL missing http(s) prefix, adding https://');
        sanitizedUrl = 'https://' + sanitizedUrl;
    }
    try {
        supabase = createClient(sanitizedUrl, SUPABASE_KEY);
    } catch (err) {
        console.warn('Supabase client initialization error:', err.message);
    }
} // else: supabase vars missing - don't warn to keep local dev clean


// Optional: direct Postgres connection for executing arbitrary (or limited) SQL against the Supabase DB.
// To enable, set SUPABASE_DB_URL (postgres connection string) and SUPABASE_SERVICE_ROLE (for logging/checking purpose).
const { Pool } = require('pg');
let pgPool = null;
if (process.env.SUPABASE_DB_URL && process.env.SUPABASE_SERVICE_ROLE) {
    // only attempt if both variables are non-empty and URL looks valid
    if (/^postgres(?:ql)?:\/\//i.test(process.env.SUPABASE_DB_URL)) {
        pgPool = new Pool({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
    } else {
        console.warn('Postgres pool warning: SUPABASE_DB_URL does not look like a postgres connection string');
    }
} // otherwise quietly skip; user can add later


const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({
    origin: ['http://localhost:3000', 'http://localhost:5500', 'http://localhost:8080', 'http://127.0.0.1:3000', 'http://127.0.0.1:5500', 'http://127.0.0.1:8080'],
    credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files with proper MIME types and cache control
app.use(express.static('.', {
    setHeaders: (res, path) => {
        if (path.endsWith('.css')) {
            res.setHeader('Content-Type', 'text/css; charset=utf-8');
        } else if (path.endsWith('.js')) {
            res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
        } else if (path.endsWith('.html')) {
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
        }
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
}));

app.use(session({
    secret: process.env.SESSION_SECRET || 'ecommerce-secret-key',
    resave: true,
    saveUninitialized: true,
    cookie: { 
        secure: false, 
        maxAge: 24 * 60 * 60 * 1000,
        sameSite: 'lax',
        httpOnly: true
    }
}));

const dbConfig = {
    host: process.env.MYSQL_HOST || 'localhost',
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'ecommerce_db',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
};

const pool = mysql.createPool(dbConfig);

const JWT_SECRET = process.env.JWT_SECRET || 'ecommerce-jwt-secret';

const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN
    
    if (!token) {
        return res.status(401).json({ success: false, message: 'Access denied' });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (error) {
        res.status(403).json({ success: false, message: 'Invalid token' });
    }
};

app.get('/api/check-session', (req, res) => {
    if (req.session.user) {
        res.json({
            logged_in: true,
            user_id: req.session.user.id,
            user_name: req.session.user.name,
            user_type: req.session.user.user_type,
            user_userid: req.session.user.userid
        });
    } else {
        res.json({ logged_in: false });
    }
});

app.post('/api/signup', async (req, res) => {
    try {
        const { name, userid, password, user_type } = req.body;


        if (!name || !userid || !password || !user_type) {
            return res.json({ success: false, message: 'All fields are required' });
        }

        if (!['customer', 'vendor'].includes(user_type)) {
            return res.json({ success: false, message: 'Invalid user type' });
        }

        if (password.length < 6) {
            return res.json({ success: false, message: 'Password must be at least 6 characters long' });
        }


        const existingUsers = await new Promise((resolve, reject) => {
            pool.query(
                'SELECT id FROM users WHERE userid = ?',
                [userid],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                }
            );
        });

        if (existingUsers.length > 0) {
            return res.json({ success: false, message: 'User ID already exists' });
        }


        // Hash password with bcrypt before storing
        const hashedPassword = await bcrypt.hash(password, 10);

        const result = await new Promise((resolve, reject) => {
            pool.query(
                'INSERT INTO users (name, userid, password, user_type) VALUES (?, ?, ?, ?)',
                [name, userid, hashedPassword, user_type],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                }
            );
        });

        res.json({ success: true, message: 'Account created successfully' });
    } catch (error) {
        console.error('Signup error:', error);
        res.json({ success: false, message: 'Database error occurred' });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { userid, password, user_type } = req.body;


        if (!userid || !password || !user_type) {
            return res.json({ success: false, message: 'All fields are required' });
        }

        if (!['customer', 'vendor'].includes(user_type)) {
            return res.json({ success: false, message: 'Invalid user type' });
        }


        let users;
        try {
            const query = 'SELECT * FROM users WHERE userid = ? AND user_type = ?';
            const result = await new Promise((resolve, reject) => {
                pool.query(query, [userid, user_type], (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                });
            });
            users = result;
        } catch (dbError) {
            console.error('Database query error:', dbError.message);
            return res.json({ success: false, message: 'Database query failed' });
        }

        if (users.length === 0) {
            return res.json({ success: false, message: 'Invalid user ID or user type' });
        }

        const user = users[0];

        // Compare password using bcrypt
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            return res.json({ success: false, message: 'Invalid password' });
        }


        const token = jwt.sign(
            { id: user.id, userid: user.userid, user_type: user.user_type },
            JWT_SECRET,
            { expiresIn: '24h' }
        );


        req.session.user = {
            id: user.id,
            name: user.name,
            userid: user.userid,
            user_type: user.user_type
        };
        req.session.token = token;
        
        // Force session save
        req.session.save((err) => {
            if (err) {
                console.error('Session save error:', err);
            }
        });

        res.json({
            success: true,
            message: 'Login successful',
            user_type: user.user_type,
            user_name: user.name,
            user_id: user.id,
            userid: user.userid,
            token: token
        });
    } catch (error) {
        console.error('Login error:', error);
        res.json({ success: false, message: 'Database error occurred' });
    }
});

app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true, message: 'Logged out successfully' });
});


app.get('/api/products', async (req, res) => {
    try {
        const limit = req.query.limit;
        let query = 'SELECT p.*, u.name as vendor_name FROM products p JOIN users u ON p.vendor_id = u.id WHERE p.stock_quantity > 0';
        let params = [];

        if (limit) {
            query += ' ORDER BY p.created_at DESC LIMIT ?';
            params.push(parseInt(limit));
        }

        const products = await new Promise((resolve, reject) => {
            pool.query(query, params, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
        res.json({ success: true, products });
    } catch (error) {
        console.error('Get products error:', error);
        res.json({ success: false, message: 'Error fetching products' });
    }
});


app.get('/api/vendor/products', authenticateToken, async (req, res) => {
    try {
        if (req.user.user_type !== 'vendor') {
            return res.status(403).json({ success: false, message: 'Access denied' });
        }

        const products = await new Promise((resolve, reject) => {
            pool.query(
                'SELECT * FROM products WHERE vendor_id = ? ORDER BY created_at DESC',
                [req.user.id],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                }
            );
        });

        res.json({ success: true, products });
    } catch (error) {
        console.error('Get vendor products error:', error);
        res.json({ success: false, message: 'Error fetching products' });
    }
});

app.post('/api/vendor/products', authenticateToken, async (req, res) => {
    try {
        if (req.user.user_type !== 'vendor') {
            return res.status(403).json({ success: false, message: 'Access denied' });
        }

        const { name, description, price, category, stock_quantity } = req.body;

        if (!name || !description || !price || !category || stock_quantity === undefined) {
            return res.json({ success: false, message: 'All fields are required' });
        }

        const result = await new Promise((resolve, reject) => {
            pool.query(
                'INSERT INTO products (vendor_id, name, description, price, category, stock_quantity) VALUES (?, ?, ?, ?, ?, ?)',
                [req.user.id, name, description, price, category, stock_quantity],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                }
            );
        });

        res.json({ success: true, message: 'Product added successfully' });
    } catch (error) {
        console.error('Add product error:', error);
        res.json({ success: false, message: 'Error adding product' });
    }
});

app.put('/api/vendor/products/:id', authenticateToken, async (req, res) => {
    try {
        if (req.user.user_type !== 'vendor') {
            return res.status(403).json({ success: false, message: 'Access denied' });
        }

        const { id } = req.params;
        const { name, price, stock_quantity } = req.body;

        await new Promise((resolve, reject) => {
            pool.query(
                'UPDATE products SET name = ?, price = ?, stock_quantity = ? WHERE id = ? AND vendor_id = ?',
                [name, price, stock_quantity, id, req.user.id],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                }
            );
        });

        res.json({ success: true, message: 'Product updated successfully' });
    } catch (error) {
        console.error('Update product error:', error);
        res.json({ success: false, message: 'Error updating product' });
    }
});

app.delete('/api/vendor/products/:id', authenticateToken, async (req, res) => {
    try {
        if (req.user.user_type !== 'vendor') {
            return res.status(403).json({ success: false, message: 'Access denied' });
        }

        const { id } = req.params;

        await new Promise((resolve, reject) => {
            pool.query(
                'DELETE FROM products WHERE id = ? AND vendor_id = ?',
                [id, req.user.id],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                }
            );
        });

        res.json({ success: true, message: 'Product deleted successfully' });
    } catch (error) {
        console.error('Delete product error:', error);
        res.json({ success: false, message: 'Error deleting product' });
    }
});

app.get('/api/vendor/stats', authenticateToken, async (req, res) => {
    try {
        if (req.user.user_type !== 'vendor') {
            return res.status(403).json({ success: false, message: 'Access denied' });
        }

        const stats = await new Promise((resolve, reject) => {
            pool.query(`
                SELECT 
                    COUNT(*) as total_products,
                    SUM(stock_quantity) as total_stock,
                    AVG(price) as average_price
                FROM products 
                WHERE vendor_id = ?
            `, [req.user.id], (err, rows) => {
                if (err) reject(err);
                else resolve(rows[0]);
            });
        });

        res.json({ success: true, ...stats });
    } catch (error) {
        console.error('Get vendor stats error:', error);
        res.json({ success: false, message: 'Error fetching stats' });
    }
});


app.get('/api/cart', authenticateToken, async (req, res) => {
    try {
        if (req.user.user_type !== 'customer') {
            return res.status(403).json({ success: false, message: 'Access denied' });
        }

        const cartItems = await new Promise((resolve, reject) => {
            pool.query(`
                SELECT c.*, p.name, p.price, p.category, p.stock_quantity
                FROM cart c
                JOIN products p ON c.product_id = p.id
                WHERE c.customer_id = ?
            `, [req.user.id], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });

        res.json({ success: true, cart_items: cartItems });
    } catch (error) {
        console.error('Get cart error:', error);
        res.json({ success: false, message: 'Error fetching cart' });
    }
});

app.post('/api/cart', authenticateToken, async (req, res) => {
    try {
        if (req.user.user_type !== 'customer') {
            return res.status(403).json({ success: false, message: 'Access denied' });
        }

        const { product_id, quantity } = req.body;

        if (!product_id || !quantity) {
            return res.json({ success: false, message: 'Product ID and quantity are required' });
        }


        const existingItems = await new Promise((resolve, reject) => {
            pool.query(
                'SELECT * FROM cart WHERE customer_id = ? AND product_id = ?',
                [req.user.id, product_id],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                }
            );
        });

        if (existingItems.length > 0) {

            await new Promise((resolve, reject) => {
                pool.query(
                    'UPDATE cart SET quantity = quantity + ? WHERE customer_id = ? AND product_id = ?',
                    [quantity, req.user.id, product_id],
                    (err, rows) => {
                        if (err) reject(err);
                        else resolve(rows);
                    }
                );
            });
        } else {

            await new Promise((resolve, reject) => {
                pool.query(
                    'INSERT INTO cart (customer_id, product_id, quantity) VALUES (?, ?, ?)',
                    [req.user.id, product_id, quantity],
                    (err, rows) => {
                        if (err) reject(err);
                        else resolve(rows);
                    }
                );
            });
        }

        res.json({ success: true, message: 'Product added to cart' });
    } catch (error) {
        console.error('Add to cart error:', error);
        res.json({ success: false, message: 'Error adding to cart' });
    }
});

app.put('/api/cart', authenticateToken, async (req, res) => {
    try {
        if (req.user.user_type !== 'customer') {
            return res.status(403).json({ success: false, message: 'Access denied' });
        }

        const { product_id, quantity } = req.body;

        if (quantity <= 0) {
            await new Promise((resolve, reject) => {
                pool.query(
                    'DELETE FROM cart WHERE customer_id = ? AND product_id = ?',
                    [req.user.id, product_id],
                    (err, rows) => {
                        if (err) reject(err);
                        else resolve(rows);
                    }
                );
            });
        } else {
            await new Promise((resolve, reject) => {
                pool.query(
                    'UPDATE cart SET quantity = ? WHERE customer_id = ? AND product_id = ?',
                    [quantity, req.user.id, product_id],
                    (err, rows) => {
                        if (err) reject(err);
                        else resolve(rows);
                    }
                );
            });
        }

        res.json({ success: true, message: 'Cart updated' });
    } catch (error) {
        console.error('Update cart error:', error);
        res.json({ success: false, message: 'Error updating cart' });
    }
});

app.delete('/api/cart/:product_id', authenticateToken, async (req, res) => {
    try {
        if (req.user.user_type !== 'customer') {
            return res.status(403).json({ success: false, message: 'Access denied' });
        }

        const { product_id } = req.params;

        await new Promise((resolve, reject) => {
            pool.query(
                'DELETE FROM cart WHERE customer_id = ? AND product_id = ?',
                [req.user.id, product_id],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                }
            );
        });

        res.json({ success: true, message: 'Item removed from cart' });
    } catch (error) {
        console.error('Remove from cart error:', error);
        res.json({ success: false, message: 'Error removing from cart' });
    }
});


app.post('/api/orders', authenticateToken, async (req, res) => {
    try {
        if (req.user.user_type !== 'customer') {
            return res.status(403).json({ success: false, message: 'Access denied' });
        }


        const cartItems = await new Promise((resolve, reject) => {
            pool.query(`
                SELECT c.*, p.name, p.price
                FROM cart c
                JOIN products p ON c.product_id = p.id
                WHERE c.customer_id = ?
            `, [req.user.id], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });

        if (cartItems.length === 0) {
            return res.json({ success: false, message: 'Cart is empty' });
        }


        const totalAmount = cartItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);


        const connection = await new Promise((resolve, reject) => {
            pool.getConnection((err, conn) => {
                if (err) reject(err);
                else resolve(conn);
            });
        });

        await new Promise((resolve, reject) => {
            connection.beginTransaction((err) => {
                if (err) reject(err);
                else resolve();
            });
        });

        try {

            const orderResult = await new Promise((resolve, reject) => {
                connection.query(
                    'INSERT INTO orders (customer_id, total_amount, status) VALUES (?, ?, ?)',
                    [req.user.id, totalAmount, 'pending'],
                    (err, result) => {
                        if (err) reject(err);
                        else resolve(result);
                    }
                );
            });

            const orderId = orderResult.insertId;


            for (const item of cartItems) {
                await new Promise((resolve, reject) => {
                    connection.query(
                        'INSERT INTO order_items (order_id, product_id, quantity, price) VALUES (?, ?, ?, ?)',
                        [orderId, item.product_id, item.quantity, item.price],
                        (err, result) => {
                            if (err) reject(err);
                            else resolve(result);
                        }
                    );
                });

                await new Promise((resolve, reject) => {
                    connection.query(
                        'UPDATE products SET stock_quantity = stock_quantity - ? WHERE id = ?',
                        [item.quantity, item.product_id],
                        (err, result) => {
                            if (err) reject(err);
                            else resolve(result);
                        }
                    );
                });
            }


            await new Promise((resolve, reject) => {
                connection.query(
                    'DELETE FROM cart WHERE customer_id = ?',
                    [req.user.id],
                    (err, result) => {
                        if (err) reject(err);
                        else resolve(result);
                    }
                );
            });

            await new Promise((resolve, reject) => {
                connection.commit((err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });

            res.json({ success: true, message: 'Order placed successfully', order_id: orderId });
        } catch (error) {
            await new Promise((resolve, reject) => {
                connection.rollback((err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
            throw error;
        } finally {
            connection.release();
        }
    } catch (error) {
        console.error('Place order error:', error);
        res.json({ success: false, message: 'Error placing order' });
    }
});

// Orders endpoint - get customer order history
app.get('/api/orders', authenticateToken, async (req, res) => {
    try {
        if (req.user.user_type !== 'customer') {
            return res.status(403).json({ success: false, message: 'Access denied' });
        }

        const orders = await new Promise((resolve, reject) => {
            pool.query(`
                SELECT o.id, o.total_amount, o.status, o.order_date,
                       JSON_ARRAYAGG(
                           JSON_OBJECT(
                               'product_name', p.name,
                               'quantity', oi.quantity,
                               'price', oi.price
                           )
                       ) as items
                FROM orders o
                LEFT JOIN order_items oi ON o.id = oi.order_id
                LEFT JOIN products p ON oi.product_id = p.id
                WHERE o.customer_id = ?
                GROUP BY o.id
                ORDER BY o.order_date DESC
            `, [req.user.id], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });

        // Parse JSON items string if needed
        const parsedOrders = orders.map(order => ({
            ...order,
            items: typeof order.items === 'string' ? JSON.parse(order.items) : order.items
        }));

        res.json({ success: true, orders: parsedOrders });
    } catch (error) {
        console.error('Get orders error:', error);
        res.json({ success: false, message: 'Error fetching orders' });
    }
});

// Supabase status endpoint — returns whether env vars are present and client initialized.
app.get('/api/supabase/status', (req, res) => {
    const configured = !!(SUPABASE_URL && SUPABASE_KEY && supabase);
    res.json({ success: true, configured, url_present: !!SUPABASE_URL });
});

// Execute SQL against Supabase Postgres (server-side). This endpoint only allows SELECT queries by default.
// Requires authentication via `authenticateToken` and a configured `SUPABASE_DB_URL`.
app.post('/api/supabase/sql', authenticateToken, async (req, res) => {
    try {
        if (!pgPool) return res.status(500).json({ success: false, message: 'SQL execution not configured on server' });

        // Only allow certain user types to run queries (adjust as needed)
        if (!req.user || req.user.user_type !== 'vendor') {
            return res.status(403).json({ success: false, message: 'Access denied' });
        }

        const { sql } = req.body;
        if (!sql || typeof sql !== 'string') return res.status(400).json({ success: false, message: 'SQL query required' });

        // Safety: only allow SELECT queries from the web SQL editor by default
        const isSelect = /^\s*SELECT\b/i.test(sql);
        if (!isSelect) return res.status(403).json({ success: false, message: 'Only SELECT queries are allowed via this editor' });

        const client = await pgPool.connect();
        try {
            const result = await client.query(sql);
            res.json({ success: true, rows: result.rows, fields: result.fields.map(f => f.name) });
        } finally {
            client.release();
        }
    } catch (err) {
        console.error('Supabase SQL execution error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});


app.get('/', (req, res) => {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Content-Type', 'text/html');
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/login', (req, res) => {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Content-Type', 'text/html');
    res.sendFile(path.join(__dirname, 'login.html'));
});

app.get('/signup', (req, res) => {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Content-Type', 'text/html');
    res.sendFile(path.join(__dirname, 'signup.html'));
});

app.get('/vendor-dashboard', (req, res) => {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Content-Type', 'text/html');
    res.sendFile(path.join(__dirname, 'vendor-dashboard.html'));
});

app.get('/vendor-products', (req, res) => {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Content-Type', 'text/html');
    res.sendFile(path.join(__dirname, 'vendor-products.html'));
});

app.get('/customer-dashboard', (req, res) => {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Content-Type', 'text/html');
    res.sendFile(path.join(__dirname, 'customer-dashboard.html'));
});

app.get('/products', (req, res) => {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Content-Type', 'text/html');
    res.sendFile(path.join(__dirname, 'products.html'));
});

app.get('/cart', (req, res) => {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Content-Type', 'text/html');
    res.sendFile(path.join(__dirname, 'cart.html'));
});

app.get('/logout', (req, res) => {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Content-Type', 'text/html');
    res.sendFile(path.join(__dirname, 'logout.html'));
});

app.get('/sql-editor', (req, res) => {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Content-Type', 'text/html');
    res.sendFile(path.join(__dirname, 'sql-editor.html'));
});


app.get('/logout-redirect', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
