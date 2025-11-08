# 🚀 DEPLOYMENT CHECKLIST - Cross-Domain Authentication Fix

## ✅ What Was Fixed:

1. **Cookie SameSite Policy**: Changed from `strict` to `none` for production
2. **Secure Flag**: Always set to `true` (required for SameSite=none)
3. **CORS Configuration**: Added better logging and exposed Set-Cookie header
4. **Frontend API URL**: Points to production backend

## 📋 Deployment Steps:

### 1. **Render Backend** (https://sms-backend-783m.onrender.com)

**Environment Variables to Set:**

```
NODE_ENV=production
FRONTEND_URL=https://your-netlify-app.netlify.app
MONGODB_URI=your-mongodb-connection-string
JWT_SECRET=your-strong-secret-key
```

**Important:**

- Replace `FRONTEND_URL` with your actual Netlify URL after deployment
- The backend will auto-redeploy when you push to main branch

### 2. **Netlify Frontend**

**Environment Variables to Set:**

```
VITE_API_BASE_URL=https://sms-backend-783m.onrender.com
```

**Build Settings:**

- Base directory: `frontend`
- Build command: `npm install && npm run build`
- Publish directory: `frontend/build`

### 3. **Update Backend After Frontend Deploys**

Once you get your Netlify URL (e.g., `https://school-management-xyz.netlify.app`):

1.  Go to Render Dashboard → Your Service → Environment
2.  Update `FRONTEND_URL` to your Netlify URL
3.  Save (triggers redeploy)

## 🔍 Testing Cross-Domain Cookies:

1. **Open Browser DevTools** → Application/Storage → Cookies
2. **Login from your Netlify frontend**
3. **Check if cookie is set** with these properties:
   - Name: `token`
   - Domain: `.onrender.com` or `sms-backend-783m.onrender.com`
   - HttpOnly: ✓
   - Secure: ✓
   - SameSite: `None`

## ⚠️ Common Issues:

### Issue: Cookie still not being sent

**Solution:** Make sure both sites use HTTPS (not HTTP). SameSite=None requires secure connection.

### Issue: CORS error in browser console

**Solution:** Check Render logs for CORS messages. The backend now logs allowed/blocked origins.

### Issue: 401 Unauthorized after login

**Solution:**

1. Check if cookie is being set in browser DevTools
2. Verify `FRONTEND_URL` in Render matches your Netlify URL exactly (including https://)
3. Check browser console for CORS errors

## 📝 How Cross-Domain Cookies Work:

```
Frontend (Netlify)          Backend (Render)
    ↓                            ↓
https://yourapp.netlify.app → https://sms-backend-783m.onrender.com
    ↓                            ↓
Login Request                Set-Cookie with:
withCredentials: true        - sameSite: 'none'
                            - secure: true
                            - httpOnly: true
    ↓                            ↓
Browser stores cookie
    ↓
Subsequent requests include cookie automatically
```

## 🎯 Key Changes in Code:

**Before (❌ Blocked by browsers):**

```typescript
sameSite: "strict"; // Only works on same domain
```

**After (✅ Works cross-domain):**

```typescript
sameSite: 'none',   // Allows cross-domain
secure: true        // Required for sameSite: none
```

## ✨ Next Steps:

1. Merge `branch2` to `main`
2. Deploy to production
3. Test login flow
4. Monitor Render logs for CORS messages
