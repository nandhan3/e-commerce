# E-Commerce Website with Node.js

A full-stack e-commerce application built with Node.js, Express.js, and MySQL. Features separate dashboards for customers and vendors with complete CRUD operations.

## Features

### For Customers:
- User registration and login
- Browse products with filtering and search
- Add products to cart
- View and manage shopping cart
- Place orders

### For Vendors:
- Vendor registration and login
- Add new products
- View and manage products
- Update product information
- Delete products
- View vendor statistics

## Prerequisites

- Node.js (v14 or higher)
- MySQL (v5.7 or higher)
- npm or yarn

## Installation

1. **Clone or download the project**
   ```bash
   cd ecommerce-website
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up MySQL database**
   - Create a MySQL database named `ecommerce_db`
   - Run the SQL script in `database.sql` to create tables and sample data:
   ```bash
   mysql -u root -p ecommerce_db < database.sql
   ```

4. **Configure database connection**
   - Update the database configuration in `server.js` if needed:
   ```javascript
   const dbConfig = {
       host: 'localhost',
       user: 'root',
       password: 'your_password', // Update this
       database: 'ecommerce_db',
       // ...
   };
   ```

5. **Start the server**
   ```bash
   npm start
   ```

6. **Access the application**
   - Open your browser and go to `http://localhost:3000`

## Sample Accounts

The database includes sample accounts for testing:

### Customer Account:
- Email: `customer@example.com`
- Password: `password`
- User Type: `customer`

### Vendor Account:
- Email: `vendor@example.com`
- Password: `password`
- User Type: `vendor`

## API Endpoints

### Authentication
- `POST /api/signup` - User registration
- `POST /api/login` - User login
- `POST /api/logout` - User logout
- `GET /api/check-session` - Check user session

### Products
- `GET /api/products` - Get all products (public)
- `GET /api/vendor/products` - Get vendor's products (authenticated)
- `POST /api/vendor/products` - Add new product (vendor only)
- `PUT /api/vendor/products/:id` - Update product (vendor only)
- `DELETE /api/vendor/products/:id` - Delete product (vendor only)
- `GET /api/vendor/stats` - Get vendor statistics (vendor only)

### Cart
- `GET /api/cart` - Get cart items (customer only)
- `POST /api/cart` - Add item to cart (customer only)
- `PUT /api/cart` - Update cart item quantity (customer only)
- `DELETE /api/cart/:product_id` - Remove item from cart (customer only)

### Orders
- `POST /api/orders` - Place order (customer only)

## Project Structure

```
ecommerce-website/
├── server.js              # Main server file
├── package.json           # Node.js dependencies
├── database.sql          # Database schema and sample data
├── index.html            # Home page
├── login.html            # Login page
├── signup.html           # Registration page
├── customer-dashboard.html # Customer dashboard
├── products.html         # Product listing page
├── cart.html            # Shopping cart page
├── vendor-dashboard.html # Vendor dashboard
├── vendor-products.html  # Vendor product management
├── styles.css           # CSS styles
└── README.md           # This file
```

## Technologies Used

- **Backend**: Node.js, Express.js
- **Database**: MySQL
- **Authentication**: JWT, bcryptjs
- **Frontend**: HTML, CSS, JavaScript (Vanilla)
- **Session Management**: express-session

## Security Features

- Password hashing with bcrypt
- JWT token authentication
- Session management
- Input validation
- SQL injection prevention with parameterized queries

## Development

To run in development mode with auto-restart:
```bash
npm install -g nodemon
npm run dev
```

## License

This project is licensed under the ISC License.
