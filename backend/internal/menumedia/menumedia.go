package menumedia

import (
	"bytes"
	"encoding/binary"
	"errors"
	"image"
	"image/color"
	stddraw "image/draw"
	"image/jpeg"
	"io"
	"math"
	"os"

	_ "image/jpeg"
	_ "image/png"

	xdraw "golang.org/x/image/draw"
	_ "golang.org/x/image/webp"
)

const (
	MaxInputBytes    int64 = 5 << 20
	MinSide                = 64
	MaxSide                = 4096
	MaxPixels              = MaxSide * MaxSide
	DisplayMaxSide         = 960
	ThumbnailMaxSide       = 480
	DisplayQuality         = 82
	ThumbnailQuality       = 76
)

var ErrInvalidImage = errors.New("invalid menu image")

func DecodeLimited(r io.Reader) (image.Image, error) {
	raw, err := io.ReadAll(io.LimitReader(r, MaxInputBytes+1))
	if err != nil {
		return nil, err
	}
	if int64(len(raw)) > MaxInputBytes {
		return nil, ErrInvalidImage
	}
	config, _, err := image.DecodeConfig(bytes.NewReader(raw))
	if err != nil {
		return nil, err
	}
	if err := validateDimensions(config.Width, config.Height); err != nil {
		return nil, err
	}
	img, _, err := image.Decode(bytes.NewReader(raw))
	if err != nil {
		return nil, err
	}
	img = ApplyOrientation(img, jpegEXIFOrientation(raw))
	if err := ValidateSource(img); err != nil {
		return nil, err
	}
	return img, nil
}

func ValidateSource(img image.Image) error {
	bounds := img.Bounds()
	return validateDimensions(bounds.Dx(), bounds.Dy())
}

func validateDimensions(width, height int) error {
	if width < MinSide || height < MinSide || width > MaxSide || height > MaxSide {
		return ErrInvalidImage
	}
	if height != 0 && width > MaxPixels/height {
		return ErrInvalidImage
	}
	return nil
}

func ApplyOrientation(src image.Image, orientation int) image.Image {
	if orientation <= 1 || orientation > 8 {
		return src
	}
	bounds := src.Bounds()
	width := bounds.Dx()
	height := bounds.Dy()
	targetWidth := width
	targetHeight := height
	if orientation >= 5 {
		targetWidth = height
		targetHeight = width
	}
	dst := image.NewRGBA(image.Rect(0, 0, targetWidth, targetHeight))
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			dx, dy := orientedPoint(x, y, width, height, orientation)
			dst.Set(dx, dy, src.At(bounds.Min.X+x, bounds.Min.Y+y))
		}
	}
	return dst
}

func orientedPoint(x, y, width, height, orientation int) (int, int) {
	switch orientation {
	case 2:
		return width - 1 - x, y
	case 3:
		return width - 1 - x, height - 1 - y
	case 4:
		return x, height - 1 - y
	case 5:
		return y, x
	case 6:
		return height - 1 - y, x
	case 7:
		return height - 1 - y, width - 1 - x
	case 8:
		return y, width - 1 - x
	default:
		return x, y
	}
}

func WriteJPEG(target string, img image.Image, quality int) error {
	var encoded bytes.Buffer
	if err := jpeg.Encode(&encoded, img, &jpeg.Options{Quality: quality}); err != nil {
		return err
	}
	out, err := os.OpenFile(target, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
	if err != nil {
		return err
	}
	defer out.Close()
	_, err = io.Copy(out, &encoded)
	return err
}

func Resize(src image.Image, maxSide int) image.Image {
	bounds := src.Bounds()
	width := bounds.Dx()
	height := bounds.Dy()
	if width <= 0 || height <= 0 {
		return src
	}
	scale := float64(maxSide) / float64(max(width, height))
	targetWidth := width
	targetHeight := height
	if scale < 1 {
		targetWidth = max(1, int(math.Round(float64(width)*scale)))
		targetHeight = max(1, int(math.Round(float64(height)*scale)))
	}
	dst := image.NewRGBA(image.Rect(0, 0, targetWidth, targetHeight))
	stddraw.Draw(dst, dst.Bounds(), &image.Uniform{C: color.White}, image.Point{}, stddraw.Src)
	if targetWidth == width && targetHeight == height {
		stddraw.Draw(dst, dst.Bounds(), src, bounds.Min, stddraw.Over)
		return dst
	}
	xdraw.CatmullRom.Scale(dst, dst.Bounds(), src, bounds, stddraw.Over, nil)
	return dst
}

func Dimensions(img image.Image) (int, int) {
	bounds := img.Bounds()
	return bounds.Dx(), bounds.Dy()
}

func jpegEXIFOrientation(raw []byte) int {
	if len(raw) < 4 || raw[0] != 0xff || raw[1] != 0xd8 {
		return 1
	}
	for offset := 2; offset+4 <= len(raw); {
		if raw[offset] != 0xff {
			return 1
		}
		for offset < len(raw) && raw[offset] == 0xff {
			offset++
		}
		if offset >= len(raw) {
			return 1
		}
		marker := raw[offset]
		offset++
		if marker == 0xda || marker == 0xd9 {
			return 1
		}
		if offset+2 > len(raw) {
			return 1
		}
		segmentLength := int(binary.BigEndian.Uint16(raw[offset : offset+2]))
		if segmentLength < 2 || offset+segmentLength > len(raw) {
			return 1
		}
		segment := raw[offset+2 : offset+segmentLength]
		if marker == 0xe1 && bytes.HasPrefix(segment, []byte("Exif\x00\x00")) {
			return tiffOrientation(segment[6:])
		}
		offset += segmentLength
	}
	return 1
}

func tiffOrientation(tiff []byte) int {
	if len(tiff) < 8 {
		return 1
	}
	var order binary.ByteOrder
	switch string(tiff[0:2]) {
	case "II":
		order = binary.LittleEndian
	case "MM":
		order = binary.BigEndian
	default:
		return 1
	}
	if order.Uint16(tiff[2:4]) != 42 {
		return 1
	}
	ifdOffset := int(order.Uint32(tiff[4:8]))
	if ifdOffset < 0 || ifdOffset+2 > len(tiff) {
		return 1
	}
	entryCount := int(order.Uint16(tiff[ifdOffset : ifdOffset+2]))
	entriesOffset := ifdOffset + 2
	for index := 0; index < entryCount; index++ {
		entryOffset := entriesOffset + index*12
		if entryOffset+12 > len(tiff) {
			return 1
		}
		entry := tiff[entryOffset : entryOffset+12]
		tag := order.Uint16(entry[0:2])
		fieldType := order.Uint16(entry[2:4])
		count := order.Uint32(entry[4:8])
		if tag == 0x0112 && fieldType == 3 && count >= 1 {
			orientation := int(order.Uint16(entry[8:10]))
			if orientation >= 1 && orientation <= 8 {
				return orientation
			}
			return 1
		}
	}
	return 1
}
