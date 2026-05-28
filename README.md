# WeRgame Frontend


### Installation

```bash
npm install
```

### Environment Variables

Create a `.env` file in the root directory:

```env
REACT_APP_API_URL=http://localhost:5000/api
```

### Running the Application

```bash
npm start
```

The app will open at `http://localhost:3000`

## 📁 Project Structure

```
src/
├── components/        # Reusable UI components
│   ├── Navbar.js     # Main navigation with filters
│   ├── LoginModal.js # Login modal
│   ├── SignupModal.js # Signup modal
│   └── WalletConnectButton.js # Web3 wallet connection
├── pages/            # Page components
│   ├── Home.js       # Landing page
│   ├── CupPage.js    # Tournament/cup page
│   ├── MatchDetail.js # Match prediction page (Free/Boost/Market)
│   ├── Admin.js      # Admin dashboard
│   └── SuperAdmin.js # SuperAdmin dashboard
├── context/          # React Context providers
│   └── AuthContext.js # Authentication context
├── utils/            # Utility functions
│   ├── api.js        # Axios API client
│   ├── theme.js      # Theme toggle utilities
│   └── web3onboard.js # Web3 wallet configuration
└── App.js            # Main app component with routing
```

## 🎨 UI Components

### Navigation
- Two-row navigation bar
- Logo and branding
- Search functionality
- Theme toggle (light/dark mode)
- Social media links
- Authentication buttons
- Tournament filters (Home, World Cup, Champions League, etc.)

### Pages

#### Home
- Displays all available cups/tournaments
- Card-based layout
- Cup status indicators

#### Cup Page
- Left sidebar with tournament timeline (stages)
- Featured match section
- Match polls list
- Award polls section
- Free/Boost/Market action buttons

#### Match Detail
Three different views based on prediction type:

1. **FREE View**
   - User-friendly interface
   - Simple prediction buttons
   - Daily ticket information

2. **BOOST View**
   - Prize pool information
   - USDC staking interface
   - Fee breakdown

3. **MARKET View**
   - Market statistics (YES/NO prices)
   - Trading interface (Buy/Sell)
   - Market sentiment
   - Comments section

#### Admin Dashboard
- Matches management
- Cups management
- Polls management
- Settings
- Create/Edit/Set results functionality

#### SuperAdmin Dashboard
- Fee management
- Contract balance monitoring
- Fund transfer functionality
- SuperAdmin address management

## 🔌 API Integration

All API calls are made through the `api.js` utility which:
- Uses Axios for HTTP requests
- Automatically includes JWT tokens in headers
- Handles base URL configuration
- Provides error handling

### API Endpoints Used

See main README.md for complete API documentation.

## 🎯 User Workflow

1. **Landing**: User sees all tournaments on home page
2. **Navigation**: Click on tournament filter or cup card
3. **Tournament View**: Browse matches and polls
4. **Prediction**: Click Free/Boost/Market button
5. **Action**: Make prediction or trade shares
6. **Tracking**: View streaks, points, leaderboard

## 🎨 Styling

- **Framework**: Tailwind CSS
- **Theme**: Supports light and dark mode
- **Responsive**: Mobile-first responsive design
- **Icons**: SVG icons inline

## 🔐 Authentication

Two authentication methods:
1. **Email/Password**: Traditional signup/login
2. **Wallet**: Connect Ethereum wallet via @web3-onboard

Authentication state managed through `AuthContext`.

## 📦 Dependencies

- `react`: UI library
- `react-router-dom`: Routing
- `axios`: HTTP client
- `@web3-onboard/core`: Web3 wallet connection
- `@web3-onboard/react`: React hooks for Web3
- `@web3-onboard/injected-wallets`: Wallet providers
- `tailwindcss`: CSS framework

## 🛠️ Development

### Available Scripts

- `npm start`: Start development server
- `npm build`: Build for production
- `npm test`: Run tests

### Building for Production

```bash
npm run build
```

The build folder will contain the optimized production build.
