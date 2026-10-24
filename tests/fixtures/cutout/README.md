# Cutout fixture

`person-microphone.jpg` is "Barack Obama speaking with microphone at BankAtlantic
Center, Sunrise Florida, 23 May 2008" by Alex Johnson, Ft. Lauderdale FL, USA.
It is used solely as a technical person/microphone segmentation fixture.

Source: https://commons.wikimedia.org/wiki/File:Barack_Obama_speaking_with_microphone_at_BankAtlantic_Center,_Sunrise_Florida,_23_May_2008.jpg

Licence: Creative Commons Attribution 2.0, https://creativecommons.org/licenses/by/2.0/
The downloaded JPEG is unmodified. Derived verification frames apply segmentation
and manual repair masks. No endorsement is implied.

The runtime model is Google's Selfie Multiclass 256 × 256 model, version 1,
Apache-2.0. Model card: https://storage.googleapis.com/mediapipe-assets/Model%20Card%20Multiclass%20Segmentation.pdf
The model distinguishes background, hair, body skin, face skin, clothes and
accessories. Accessories are a different backend from native Tandem's RVM/Vision.

`alpha-sticker.gif`, `alpha-sticker.webp` and `alpha-sticker.apng` are synthetic
64 × 64, two-frame fixtures generated for SideCut with FFmpeg. A red square moves
from x=8 to x=32 over transparent pixels, with 0.5 seconds per frame. These three
fixtures are dedicated to the public domain under CC0.
