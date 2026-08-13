package menumedia

import (
	"bytes"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"hash/crc32"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"io"
	"testing"
)

func TestDecodeLimitedAcceptsSupportedFormats(t *testing.T) {
	src := testImage(80, 70)
	webpBytes, err := base64.StdEncoding.DecodeString("UklGRjgAAABXRUJQVlA4TCwAAAAvT0ARALkyRPQ/dhHR/4Datm0Yl+T/xz2mKAQQAAXN4MUEgFjaBpD2/TdAAQ==")
	if err != nil {
		t.Fatalf("decode webp fixture: %v", err)
	}
	tests := []struct {
		name string
		raw  []byte
	}{
		{name: "png", raw: encodePNG(t, src)},
		{name: "jpeg", raw: encodeJPEG(t, src)},
		{name: "webp", raw: webpBytes},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			decoded, err := DecodeLimited(bytes.NewReader(test.raw))
			if err != nil {
				t.Fatalf("decode %s: %v", test.name, err)
			}
			width, height := Dimensions(decoded)
			if width != 80 || height != 70 {
				t.Fatalf("unexpected dimensions: %dx%d", width, height)
			}
		})
	}
}

func TestDecodeLimitedAppliesJPEGEXIFOrientation(t *testing.T) {
	raw := withEXIFOrientation(t, encodeJPEG(t, testImage(80, 120)), 6)
	decoded, err := DecodeLimited(bytes.NewReader(raw))
	if err != nil {
		t.Fatalf("decode jpeg with exif orientation: %v", err)
	}
	width, height := Dimensions(decoded)
	if width != 120 || height != 80 {
		t.Fatalf("exif orientation was not applied: %dx%d", width, height)
	}
}

func TestDecodeLimitedRejectsOversizedInputBeforeDecode(t *testing.T) {
	_, err := DecodeLimited(io.MultiReader(bytes.NewReader(encodePNG(t, testImage(80, 70))), io.LimitReader(zeroReader{}, MaxInputBytes)))
	if !errors.Is(err, ErrInvalidImage) {
		t.Fatalf("expected ErrInvalidImage for input larger than %d bytes, got %v", MaxInputBytes, err)
	}
}

func TestDecodeLimitedRejectsOversizedPNGFromHeaderBeforeFullDecode(t *testing.T) {
	_, err := DecodeLimited(bytes.NewReader(pngHeaderWithDimensions(MaxSide+1, MinSide)))
	if !errors.Is(err, ErrInvalidImage) {
		t.Fatalf("expected ErrInvalidImage for oversized image header, got %v", err)
	}
}

func TestValidateSourceRejectsUnsafeDimensions(t *testing.T) {
	for _, test := range []struct {
		name string
		img  image.Image
	}{
		{name: "too narrow", img: image.NewRGBA(image.Rect(0, 0, MinSide-1, MinSide))},
		{name: "too short", img: image.NewRGBA(image.Rect(0, 0, MinSide, MinSide-1))},
		{name: "too wide", img: image.NewRGBA(image.Rect(0, 0, MaxSide+1, MinSide))},
		{name: "too tall", img: image.NewRGBA(image.Rect(0, 0, MinSide, MaxSide+1))},
	} {
		t.Run(test.name, func(t *testing.T) {
			if err := ValidateSource(test.img); !errors.Is(err, ErrInvalidImage) {
				t.Fatalf("expected ErrInvalidImage, got %v", err)
			}
		})
	}
}

func TestResizeKeepsSmallImageAndDownscalesLargeImage(t *testing.T) {
	small := image.NewRGBA(image.Rect(0, 0, 80, 70))
	smallResized := Resize(small, 480)
	width, height := Dimensions(smallResized)
	if width != 80 || height != 70 {
		t.Fatalf("small image was upscaled: %dx%d", width, height)
	}

	large := image.NewRGBA(image.Rect(0, 0, 2000, 1000))
	largeResized := Resize(large, 960)
	width, height = Dimensions(largeResized)
	if width != 960 || height != 480 {
		t.Fatalf("large image resized incorrectly: %dx%d", width, height)
	}
}

func testImage(width, height int) *image.RGBA {
	src := image.NewRGBA(image.Rect(0, 0, width, height))
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			src.Set(x, y, color.RGBA{R: uint8((x * 3) % 256), G: uint8((y * 5) % 256), B: 120, A: 255})
		}
	}
	return src
}

func encodePNG(t *testing.T, img image.Image) []byte {
	t.Helper()
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, img); err != nil {
		t.Fatalf("encode png: %v", err)
	}
	return encoded.Bytes()
}

func encodeJPEG(t *testing.T, img image.Image) []byte {
	t.Helper()
	var encoded bytes.Buffer
	if err := jpeg.Encode(&encoded, img, &jpeg.Options{Quality: DisplayQuality}); err != nil {
		t.Fatalf("encode jpeg: %v", err)
	}
	return encoded.Bytes()
}

func withEXIFOrientation(t *testing.T, jpegBytes []byte, orientation uint16) []byte {
	t.Helper()
	if len(jpegBytes) < 2 || jpegBytes[0] != 0xff || jpegBytes[1] != 0xd8 {
		t.Fatal("test jpeg must start with SOI")
	}
	var exif bytes.Buffer
	exif.WriteString("Exif\x00\x00")
	exif.WriteString("MM")
	_ = binary.Write(&exif, binary.BigEndian, uint16(42))
	_ = binary.Write(&exif, binary.BigEndian, uint32(8))
	_ = binary.Write(&exif, binary.BigEndian, uint16(1))
	_ = binary.Write(&exif, binary.BigEndian, uint16(0x0112))
	_ = binary.Write(&exif, binary.BigEndian, uint16(3))
	_ = binary.Write(&exif, binary.BigEndian, uint32(1))
	_ = binary.Write(&exif, binary.BigEndian, orientation)
	_ = binary.Write(&exif, binary.BigEndian, uint16(0))
	_ = binary.Write(&exif, binary.BigEndian, uint32(0))

	var out bytes.Buffer
	out.Write(jpegBytes[:2])
	out.Write([]byte{0xff, 0xe1})
	_ = binary.Write(&out, binary.BigEndian, uint16(exif.Len()+2))
	out.Write(exif.Bytes())
	out.Write(jpegBytes[2:])
	return out.Bytes()
}

func pngHeaderWithDimensions(width, height int) []byte {
	var out bytes.Buffer
	out.Write([]byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n'})
	writePNGChunk(&out, "IHDR", func() []byte {
		data := make([]byte, 13)
		binary.BigEndian.PutUint32(data[0:4], uint32(width))
		binary.BigEndian.PutUint32(data[4:8], uint32(height))
		data[8] = 8
		data[9] = 2
		return data
	}())
	writePNGChunk(&out, "IEND", nil)
	return out.Bytes()
}

func writePNGChunk(out *bytes.Buffer, name string, data []byte) {
	_ = binary.Write(out, binary.BigEndian, uint32(len(data)))
	out.WriteString(name)
	out.Write(data)
	checksum := crc32.NewIEEE()
	_, _ = checksum.Write([]byte(name))
	_, _ = checksum.Write(data)
	_ = binary.Write(out, binary.BigEndian, checksum.Sum32())
}

type zeroReader struct{}

func (zeroReader) Read(p []byte) (int, error) {
	for index := range p {
		p[index] = 0
	}
	return len(p), nil
}
