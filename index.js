const express = require('require')
const cors = require('cors')
const { MongoClient, ObjectId } = require('mongodb')

const app = express()


app.use(cors())

app.use(express.json())

app.use(express.urlencoded({ extended: true }))

app.use((req, res, next) => {

    const timestamp = new Date().toISOString()

    console.log(`[${timestamp}] ${req.method} request to ${req.url}`)

    if (req.body && Object.keys(req.body).length > 0) {
        console.log('Request body:', req.body)
    }

    next()
})

app.use('/images', express.static('public/images', {

  fallthrough: false
}))

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

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`)
})

const mongoUrl = "mongodb://localhost:27017" || 'mongodb+srv://your-username:your-password@cluster0.mongodb.net/'
const client = new MongoClient(mongoUrl)

let db

async function connectToDatabase() {
  try {
    await client.connect()
    console.log('✅ Successfully connected to MongoDB Atlas')
    
    db = client.db('afterschool')
    
    const collections = await db.listCollections().toArray()
    console.log('Available collections:', collections.map(c => c.name))
    
  } catch (error) {
    console.error('❌ Failed to connect to MongoDB:', error)
    process.exit(1) 
  }
}

connectToDatabase()

app.get('/lessons', async (req, res) => {
  try {
    console.log('📚 Fetching all lessons from database...')

    const lessonsCollection = db.collection('lessons')

    const lessons = await lessonsCollection.find({}).toArray()
    
    console.log(`Found ${lessons.length} lessons`)
    
    res.status(200).json(lessons)
    
  } catch (error) {
    console.error('Error fetching lessons:', error)
    res.status(500).json({ 
      error: 'Failed to fetch lessons',
      message: error.message 
    })
  }
})

app.get('/search', async (req, res) => {
  try {

    const searchTerm = req.query.query || ''
    
    console.log(`🔍 Searching for lessons with term: "${searchTerm}"`)
    
    if (!searchTerm.trim()) {
      const lessonsCollection = db.collection('lessons')
      const allLessons = await lessonsCollection.find({}).toArray()
      return res.status(200).json(allLessons)
    }

    const lessonsCollection = db.collection('lessons')
    
    const searchResults = await lessonsCollection.find({
      $or: [
        { subject: { $regex: searchTerm, $options: 'i' } },      
        { location: { $regex: searchTerm, $options: 'i' } },     
        { $expr: { $regexMatch: { input: { $toString: "$price" }, regex: searchTerm, options: 'i' } } }, 
        { $expr: { $regexMatch: { input: { $toString: "$spaces" }, regex: searchTerm, options: 'i' } } }  
      ]
    }).toArray()
    
    console.log(`Found ${searchResults.length} lessons matching "${searchTerm}"`)
    
    
    res.status(200).json(searchResults)
    
  } catch (error) {
    console.error('Error searching lessons:', error)
    res.status(500).json({ 
      error: 'Search failed',
      message: error.message 
    })
  }
})

app.post('/orders', async (req, res) => {
  try {
    console.log('📝 Creating new order...')
    
    const orderData = req.body
    
    if (!orderData.name || !orderData.phone || !orderData.lessons) {
      return res.status(400).json({
        error: 'Missing required fields',
        message: 'Order must include name, phone, and lessons'
      })
    }

    orderData.createdAt = new Date()
    orderData.orderId = new ObjectId().toString() 
    
    console.log('Order details:', {
      name: orderData.name,
      phone: orderData.phone,
      lessonsCount: orderData.lessons.length,
      orderId: orderData.orderId
    })
    
    const ordersCollection = db.collection('orders')
    
    const result = await ordersCollection.insertOne(orderData)
    
    console.log('✅ Order saved successfully with ID:', result.insertedId)
    
    await updateLessonSpaces(orderData.lessons)
    
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

// vccvcvccvcvcvc