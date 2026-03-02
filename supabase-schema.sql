-- Supabase SQL Schema for E-Commerce Website
-- Run this in the Supabase SQL Editor or your SQL Editor at http://localhost:3000/sql-editor.html

-- ============================================
-- 1. USERS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    userid VARCHAR(100) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    user_type VARCHAR(50) NOT NULL CHECK (user_type IN ('customer', 'vendor')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE INDEX idx_users_userid ON users(userid);
CREATE INDEX idx_users_user_type ON users(user_type);

-- ============================================
-- 2. PRODUCTS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS products (
    id SERIAL PRIMARY KEY,
    vendor_id INT NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    price DECIMAL(10, 2) NOT NULL,
    category VARCHAR(100),
    stock_quantity INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (vendor_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_products_vendor_id ON products(vendor_id);
CREATE INDEX idx_products_category ON products(category);
CREATE INDEX idx_products_stock ON products(stock_quantity);

-- ============================================
-- 3. CART TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS cart (
    id SERIAL PRIMARY KEY,
    customer_id INT NOT NULL,
    product_id INT NOT NULL,
    quantity INT NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    UNIQUE KEY unique_cart_item (customer_id, product_id)
);

CREATE INDEX idx_cart_customer_id ON cart(customer_id);
CREATE INDEX idx_cart_product_id ON cart(product_id);

-- ============================================
-- 4. ORDERS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS orders (
    id SERIAL PRIMARY KEY,
    customer_id INT NOT NULL,
    total_amount DECIMAL(10, 2) NOT NULL,
    status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'shipped', 'delivered', 'cancelled')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_orders_customer_id ON orders(customer_id);
CREATE INDEX idx_orders_status ON orders(status);

-- ============================================
-- 5. ORDER_ITEMS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS order_items (
    id SERIAL PRIMARY KEY,
    order_id INT NOT NULL,
    product_id INT NOT NULL,
    quantity INT NOT NULL,
    price DECIMAL(10, 2) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL
);

CREATE INDEX idx_order_items_order_id ON order_items(order_id);
CREATE INDEX idx_order_items_product_id ON order_items(product_id);

-- ============================================
-- SAMPLE DATA (Optional - for testing)
-- ============================================

-- Insert sample vendor user
INSERT INTO users (name, userid, password, user_type) 
VALUES ('John Vendor', 'vendor1', 'password123', 'vendor')
ON DUPLICATE KEY UPDATE updated_at = CURRENT_TIMESTAMP;

-- Insert sample customer users
INSERT INTO users (name, userid, password, user_type) 
VALUES ('Alice Customer', 'customer1', 'password123', 'customer')
ON DUPLICATE KEY UPDATE updated_at = CURRENT_TIMESTAMP;

INSERT INTO users (name, userid, password, user_type) 
VALUES ('Bob Customer', 'customer2', 'password123', 'customer')
ON DUPLICATE KEY UPDATE updated_at = CURRENT_TIMESTAMP;

-- Insert sample products (assuming vendor_id = 1)
INSERT INTO products (vendor_id, name, description, price, category, stock_quantity) 
VALUES 
(1, 'Laptop', 'High-performance laptop for developers', 1200.00, 'Electronics', 5),
(1, 'Mouse', 'Wireless gaming mouse', 45.00, 'Accessories', 20),
(1, 'Keyboard', 'Mechanical keyboard with RGB', 120.00, 'Accessories', 15),
(1, 'Monitor', '4K Ultra HD Monitor', 350.00, 'Electronics', 8)
ON DUPLICATE KEY UPDATE updated_at = CURRENT_TIMESTAMP;

-- ============================================
-- USEFUL QUERIES
-- ============================================

-- Get total sales by vendor
-- SELECT u.name, COUNT(o.id) as total_orders, SUM(o.total_amount) as total_revenue
-- FROM users u
-- LEFT JOIN products p ON u.id = p.vendor_id
-- LEFT JOIN order_items oi ON p.id = oi.product_id
-- LEFT JOIN orders o ON oi.order_id = o.id
-- WHERE u.user_type = 'vendor'
-- GROUP BY u.id;

-- Get customer order history
-- SELECT o.id, o.total_amount, o.status, o.created_at, COUNT(oi.id) as item_count
-- FROM orders o
-- LEFT JOIN order_items oi ON o.id = oi.order_id
-- WHERE o.customer_id = 1
-- GROUP BY o.id
-- ORDER BY o.created_at DESC;

-- Get top selling products
-- SELECT p.id, p.name, p.price, SUM(oi.quantity) as units_sold, SUM(oi.quantity * oi.price) as revenue
-- FROM products p
-- JOIN order_items oi ON p.id = oi.product_id
-- GROUP BY p.id
-- ORDER BY units_sold DESC
-- LIMIT 10;
