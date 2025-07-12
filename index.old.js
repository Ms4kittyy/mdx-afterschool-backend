// Import all the libraries we need
const express = require('express')        // Web framework for creating API
const cors = require('cors')              // Allows frontend to connect to backend
const { MongoClient, ObjectId } = require('mongodb')  // Database connection tools

// Create our web application
const app = express()

// MIDDLEWARE SETUP (these run for every request)

// Enable CORS so Vue.js frontend can talk to this backend
app.use(cors())

// Allow our app to understand JSON data from requests
app.use(express.json())

// Allow our app to understand form data from requests  
app.use(express.urlencoded({ extended: true }))

// LOGGER MIDDLEWARE (Required by coursework - logs all requests)
app.use((req, res, next) => {
  // Get current date and time for the log
  const timestamp = new Date().toISOString()
  
  // Log the request method, URL, and timestamp
  console.log(`[${timestamp}] ${req.method} request to ${req.url}`)
  
  // If there's request body data, log it too
  if (req.body && Object.keys(req.body).length > 0) {
    console.log('Request body:', req.body)
  }
  
  // Continue to the next middleware or route
  next()
})

// STATIC FILE MIDDLEWARE (Required by coursework - serves lesson images)
app.use('/images', express.static('public/images', {
  // This function runs when a file is requested but doesn't exist
  fallthrough: false
}))

// Handle errors when image files don't exist
app.use('/images', (err, req, res, next) => {
  if (err) {
    console.error(`Image not found: ${req.url}`)
    res.status(404).json({ 
      error: 'Image not found',
      message: `The requested image ${req.url} does not exist`
    })
  } else {
    next()
  }
})

// Start the server on port 3000 (or port provided by hosting service)
const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`)
})

// DATABASE CONNECTION SETUP

// Connect to MongoDB Atlas (cloud database)
const mongoUrl = "mongodb://localhost:27017" || 'mongodb+srv://your-username:your-password@cluster0.mongodb.net/'
const client = new MongoClient(mongoUrl)

// Variable to store our database connection
let db

// Connect to the database when the server starts
async function connectToDatabase() {
  try {
    await client.connect()
    console.log('✅ Successfully connected to MongoDB Atlas')
    
    // Get reference to our database (replace 'afterschool' with your database name)
    db = client.db('afterschool')
    
    // Test the connection by getting collection names
    const collections = await db.listCollections().toArray()
    console.log('Available collections:', collections.map(c => c.name))
    
  } catch (error) {
    console.error('❌ Failed to connect to MongoDB:', error)
    process.exit(1) // Stop the server if database connection fails
  }
}

// Start database connection
connectToDatabase()

// API ROUTES (these handle requests from the frontend)

// ROUTE 1: GET /lessons - Returns all lessons (Required by coursework)
app.get('/lessons', async (req, res) => {
  try {
    console.log('📚 Fetching all lessons from database...')
    
    // Get the lessons collection from database
    const lessonsCollection = db.collection('lessons')
    
    // Find all lessons and convert to array
    const lessons = await lessonsCollection.find({}).toArray()
    
    console.log(`Found ${lessons.length} lessons`)
    
    // Send lessons back as JSON with success status
    res.status(200).json(lessons)
    
  } catch (error) {
    console.error('Error fetching lessons:', error)
    res.status(500).json({ 
      error: 'Failed to fetch lessons',
      message: error.message 
    })
  }
})

// ROUTE 2: GET /search - Search lessons (Challenge component)
app.get('/search', async (req, res) => {
  try {
    // Get the search term from URL query parameter
    const searchTerm = req.query.query || ''
    
    console.log(`🔍 Searching for lessons with term: "${searchTerm}"`)
    
    // If no search term provided, return all lessons
    if (!searchTerm.trim()) {
      const lessonsCollection = db.collection('lessons')
      const allLessons = await lessonsCollection.find({}).toArray()
      return res.status(200).json(allLessons)
    }
    
    // Get the lessons collection
    const lessonsCollection = db.collection('lessons')
    
    // Search in multiple fields using MongoDB $or operator
    // This searches in subject, location, and converts price/spaces to string for searching
    const searchResults = await lessonsCollection.find({
      $or: [
        { subject: { $regex: searchTerm, $options: 'i' } },      // Search in subject (case insensitive)
        { location: { $regex: searchTerm, $options: 'i' } },     // Search in location
        { $expr: { $regexMatch: { input: { $toString: "$price" }, regex: searchTerm, options: 'i' } } }, // Search in price
        { $expr: { $regexMatch: { input: { $toString: "$spaces" }, regex: searchTerm, options: 'i' } } }  // Search in spaces
      ]
    }).toArray()
    
    console.log(`Found ${searchResults.length} lessons matching "${searchTerm}"`)
    
    // Return search results
    res.status(200).json(searchResults)
    
  } catch (error) {
    console.error('Error searching lessons:', error)
    res.status(500).json({ 
      error: 'Search failed',
      message: error.message 
    })
  }
})

// ROUTE 3: POST /orders - Save a new order (Required by coursework)
app.post('/orders', async (req, res) => {
  try {
    console.log('📝 Creating new order...')
    
    // Get order data from request body
    const orderData = req.body
    
    // Validate that we have required order information
    if (!orderData.name || !orderData.phone || !orderData.lessons) {
      return res.status(400).json({
        error: 'Missing required fields',
        message: 'Order must include name, phone, and lessons'
      })
    }
    
    // Add timestamp to the order
    orderData.createdAt = new Date()
    orderData.orderId = new ObjectId().toString() // Generate unique order ID
    
    console.log('Order details:', {
      name: orderData.name,
      phone: orderData.phone,
      lessonsCount: orderData.lessons.length,
      orderId: orderData.orderId
    })
    
    // Get the orders collection
    const ordersCollection = db.collection('orders')
    
    // Save the order to database
    const result = await ordersCollection.insertOne(orderData)
    
    console.log('✅ Order saved successfully with ID:', result.insertedId)
    
    // Update lesson spaces after successful order
    await updateLessonSpaces(orderData.lessons)
    
    // Return success response
    res.status(201).json({
      success: true,
      message: 'Order created successfully',
      orderId: result.insertedId,
      orderNumber: orderData.orderId
    })
    
  } catch (error) {
    console.error('Error creating order:', error)
    res.status(500).json({ 
      error: 'Failed to create order',
      message: error.message 
    })
  }
})

// ROUTE 4: PUT /lessons/:id - Update lesson spaces (Required by coursework)
app.put('/lessons/:id', async (req, res) => {
  try {
    // Get lesson ID from URL parameter
    const lessonId = req.params.id
    
    // Get update data from request body
    const updateData = req.body
    
    console.log(`📝 Updating lesson ${lessonId}:`, updateData)
    
    // Validate that we have data to update
    if (!updateData || Object.keys(updateData).length === 0) {
      return res.status(400).json({
        error: 'No update data provided',
        message: 'Request body must contain fields to update'
      })
    }
    
    // Get the lessons collection
    const lessonsCollection = db.collection('lessons')
    
    // Update the lesson by ID
    const result = await lessonsCollection.updateOne(
      { _id: new ObjectId(lessonId) },  // Find lesson by ID
      { $set: updateData }              // Update with new data
    )
    
    // Check if lesson was found and updated
    if (result.matchedCount === 0) {
      return res.status(404).json({
        error: 'Lesson not found',
        message: `No lesson found with ID: ${lessonId}`
      })
    }
    
    if (result.modifiedCount === 0) {
      return res.status(200).json({
        message: 'No changes made to lesson',
        lessonId: lessonId
      })
    }
    
    console.log('✅ Lesson updated successfully')
    
    // Return success response
    res.status(200).json({
      success: true,
      message: 'Lesson updated successfully',
      modifiedCount: result.modifiedCount
    })
    
  } catch (error) {
    console.error('Error updating lesson:', error)
    
    // Handle invalid ObjectId error
    if (error.name === 'BSONTypeError') {
      return res.status(400).json({
        error: 'Invalid lesson ID format',
        message: 'The provided lesson ID is not valid'
      })
    }
    
    res.status(500).json({ 
      error: 'Failed to update lesson',
      message: error.message 
    })
  }
})

// HELPER FUNCTION: Update lesson spaces after order is placed
async function updateLessonSpaces(orderedLessons) {
  try {
    console.log('🔄 Updating lesson spaces after order...')
    
    // Get the lessons collection
    const lessonsCollection = db.collection('lessons')
    
    // Process each lesson in the order
    for (const lesson of orderedLessons) {
      try {
        // Find the lesson in database
        const lessonInDb = await lessonsCollection.findOne({ 
          _id: new ObjectId(lesson.id) 
        })
        
        if (!lessonInDb) {
          console.warn(`⚠️ Lesson not found: ${lesson.id}`)
          continue
        }
        
        // Calculate new available spaces
        ewSpaces = lessonInDb.spaces - lesson.quantityconst 
        
        // Make sure spaces don't go below 0
        const updatedSpaces = Math.max(0, newSpaces)
        
        // Update the lesson spaces
        await lessonsCollection.updateOne(
          { _id: new ObjectId(lesson.id) },
          { $set: { spaces: updatedSpaces } }
        )
        
        console.log(`✅ Updated lesson "${lessonInDb.subject}": ${lessonInDb.spaces} → ${updatedSpaces} spaces`)
        
      } catch (lessonError) {
        console.error(`Error updating lesson ${lesson.id}:`, lessonError.message)
      }
    }
    
    console.log('✅ Finished updating lesson spaces')
    
  } catch (error) {
    console.error('Error in updateLessonSpaces:', error)
    throw error
  }
}

// ROUTE 5: GET /orders - Get all orders (Extra route for testing)
app.get('/orders', async (req, res) => {
  try {
    console.log('📋 Fetching all orders...')
    
    // Get the orders collection
    const ordersCollection = db.collection('orders')
    
    // Find all orders, sorted by creation date (newest first)
    const orders = await ordersCollection
      .find({})
      .sort({ createdAt: -1 })
      .toArray()
    
    console.log(`Found ${orders.length} orders`)
    
    // Return orders
    res.status(200).json(orders)
    
  } catch (error) {
    console.error('Error fetching orders:', error)
    res.status(500).json({ 
      error: 'Failed to fetch orders',
      message: error.message 
    })
  }
})

// ROUTE 6: GET / - Basic route to test if server is running
app.get('/', (req, res) => {
  res.json({
    message: '🎓 After School Classes API is running!',
    version: '1.0.0',
    endpoints: [
      'GET /lessons - Get all lessons',
      'GET /search?query=term - Search lessons',
      'POST /orders - Create new order',
      'PUT /lessons/:id - Update lesson',
      'GET /orders - Get all orders'
    ],
    timestamp: new Date().toISOString()
  })
})

// ERROR HANDLING MIDDLEWARE (catches any unhandled errors)
app.use((error, req, res, next) => {
  console.error('💥 Unhandled error:', error)
  res.status(500).json({
    error: 'Internal server error',
    message: 'Something went wrong on the server'
  })
})

// HANDLE ROUTE NOT FOUND (when someone requests a route that doesn't exist)
app.use('*', (req, res) => {
  console.log(`❓ Route not found: ${req.method} ${req.orignalUrl}`)
  res.status(404).json({
    error: 'Route not found',
    message: `The route ${req.method} ${req.originalUrl} does not exist`,
    availableRoutes: [
      'GET /',
      'GET /lessons',
      'GET /search',
      'POST /orders',
      'PUT /lessons/:id',
      'GET /orders'
    ]
  })
})

// GRACEFUL SHUTDOWN (properly close database connection when server stops)
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down server...')
  try {
    await client.close()
    console.log('📁 Database connection closed')
    process.exit(0)
  } catch (error) {
    console.error('Error during shutdown:', error)
    process.exit(1)
  }
})