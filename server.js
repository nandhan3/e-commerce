const express = require('express');
const mysql = require('mysql2');
// bcrypt removed - using plain text passwords
const jwt = require('jsonwebtoken');
const cors = require('cors');
const session = require('express-session');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({
    origin: ['http://localhost:3000', 'http://localhost:5500', 'http://localhost:8080', 'http://127.0.0.1:3000', 'http://127.0.0.1:5500', 'http://127.0.0.1:8080'],
    credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('.'));

app.use(session({
    secret: 'ecommerce-secret-key',
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
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'ecommerce_db',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
};

const pool = mysql.createPool(dbConfig);

const JWT_SECRET = 'ecommerce-jwt-secret';

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
    console.log('Session check - Session ID:', req.sessionID);
    console.log('Session check - Session:', req.session);
    console.log('Session check - User:', req.session.user);
    
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


        // Store password in plain text (no hashing)


        const result = await new Promise((resolve, reject) => {
            pool.query(
                'INSERT INTO users (name, userid, password, user_type) VALUES (?, ?, ?, ?)',
                [name, userid, password, user_type],
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


        console.log('Attempting to query database for user:', userid, user_type);
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
            console.log('Database query result:', users);
        } catch (dbError) {
            console.error('Database query error:', dbError);
            console.error('Error details:', dbError.message);
            console.error('Error code:', dbError.code);
            return res.json({ success: false, message: 'Database query failed: ' + dbError.message });
        }

        if (users.length === 0) {
            return res.json({ success: false, message: 'Invalid user ID or user type' });
        }

        const user = users[0];


        console.log('Comparing password:', password, 'with stored password:', user.password);
        const validPassword = (password === user.password);
        console.log('Password valid:', validPassword);
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
            } else {
                console.log('Session saved successfully');
            }
        });
        
        console.log('Session after login:', req.session);
        console.log('Session ID:', req.sessionID);

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


app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'login.html'));
});

app.get('/signup', (req, res) => {
    res.sendFile(path.join(__dirname, 'signup.html'));
});

app.get('/vendor-dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'vendor-dashboard.html'));
});

app.get('/vendor-products', (req, res) => {
    res.sendFile(path.join(__dirname, 'vendor-products.html'));
});

app.get('/customer-dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'customer-dashboard.html'));
});

app.get('/products', (req, res) => {
    res.sendFile(path.join(__dirname, 'products.html'));
});

app.get('/cart', (req, res) => {
    res.sendFile(path.join(__dirname, 'cart.html'));
});

app.get('/logout', (req, res) => {
    res.sendFile(path.join(__dirname, 'logout.html'));
});


app.get('/logout-redirect', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
