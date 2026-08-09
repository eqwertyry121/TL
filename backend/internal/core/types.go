package core

import (
	"errors"
	"time"

	"github.com/google/uuid"
)

type Role string

const (
	RoleClient  Role = "CLIENT"
	RoleKitchen Role = "KITCHEN"
	RoleCourier Role = "COURIER"
	RoleAdmin   Role = "ADMIN"
)

type Audience string

const (
	AudienceClient Audience = "client"
	AudienceStaff  Audience = "staff"
)

type FulfillmentStatus string

const (
	StatusNew            FulfillmentStatus = "NEW"
	StatusOutForDelivery FulfillmentStatus = "OUT_FOR_DELIVERY"
	StatusDelivered      FulfillmentStatus = "DELIVERED"
	StatusCancelled      FulfillmentStatus = "CANCELLED"
)

type PaymentMethod string

const (
	PaymentCash   PaymentMethod = "cash"
	PaymentCard   PaymentMethod = "card"
	PaymentCrypto PaymentMethod = "crypto"
)

type PaymentStatus string

const (
	PaymentCashPending PaymentStatus = "CASH_PENDING"
	PaymentPaid        PaymentStatus = "PAID"
	PaymentFailed      PaymentStatus = "FAILED"
	PaymentRefunded    PaymentStatus = "REFUNDED"
)

var (
	ErrForbidden             = errors.New("forbidden")
	ErrInvalidRole           = errors.New("invalid role")
	ErrRestaurantClosed      = errors.New("restaurant closed")
	ErrManualDayOff          = errors.New("manual day off")
	ErrItemUnavailable       = errors.New("item unavailable")
	ErrInvalidQuantity       = errors.New("invalid quantity")
	ErrOrderStatusConflict   = errors.New("order status conflict")
	ErrIdempotencyConflict   = errors.New("idempotency conflict")
	ErrCalculationExpired    = errors.New("calculation expired")
	ErrPaymentNotConfirmed   = errors.New("payment not confirmed")
	ErrTermsRequired         = errors.New("terms acceptance required")
	ErrProductionUnsafeValue = errors.New("unsafe production config")
)

type User struct {
	ID             uuid.UUID `json:"id"`
	TelegramUserID int64     `json:"telegram_user_id"`
	Username       string    `json:"username"`
	FirstName      string    `json:"first_name"`
	LanguageCode   string    `json:"language_code"`
}

type Session struct {
	Token          string    `json:"token,omitempty"`
	TokenHash      string    `json:"-"`
	UserID         uuid.UUID `json:"user_id"`
	TelegramUserID int64     `json:"telegram_user_id"`
	Audience       Audience  `json:"audience"`
	ActiveRole     Role      `json:"active_role"`
	ExpiresAt      time.Time `json:"expires_at"`
}

type Settings struct {
	Timezone             string `json:"timezone"`
	Currency             string `json:"currency"`
	ManualDayOff         bool   `json:"manual_day_off"`
	DayOffBanner         string `json:"day_off_banner"`
	FlatDeliveryFeeMinor int    `json:"flat_delivery_fee_minor"`
	SupportText          string `json:"support_text"`
	MaxItemQuantity      int    `json:"max_item_quantity"`
	MaxCommentLength     int    `json:"max_comment_length"`
	CashEnabled          bool   `json:"cash_enabled"`
	CardEnabled          bool   `json:"card_enabled"`
	CryptoEnabled        bool   `json:"crypto_enabled"`
}

type Runtime struct {
	ServerTime           time.Time `json:"server_time"`
	Timezone             string    `json:"timezone"`
	AcceptingOrders      bool      `json:"accepting_orders"`
	Reason               string    `json:"reason"`
	NextOpening          time.Time `json:"next_opening"`
	DayOffBanner         string    `json:"day_off_banner"`
	FlatDeliveryFeeMinor int       `json:"flat_delivery_fee_minor"`
	Currency             string    `json:"currency"`
	EnabledPayments      []string  `json:"enabled_payments"`
	SupportedLocales     []string  `json:"supported_locales"`
	SupportText          string    `json:"support_text"`
}

type Category struct {
	ID        uuid.UUID  `json:"id"`
	Title     string     `json:"title"`
	SortOrder int        `json:"sort_order"`
	Items     []MenuItem `json:"items"`
}

type MenuItem struct {
	ID           uuid.UUID `json:"id"`
	CategoryID   uuid.UUID `json:"category_id"`
	Title        string    `json:"title"`
	Description  string    `json:"description"`
	PriceMinor   int       `json:"price_minor"`
	Currency     string    `json:"currency"`
	PhotoPath    string    `json:"photo_path"`
	WeightText   string    `json:"weight_text"`
	AllergenText string    `json:"allergen_text"`
	SortOrder    int       `json:"sort_order"`
	Version      int       `json:"version"`
}

type CartItemInput struct {
	ItemID   uuid.UUID `json:"item_id"`
	Quantity int       `json:"quantity"`
}

type CalculatedItem struct {
	ItemID         uuid.UUID `json:"item_id"`
	Title          string    `json:"title"`
	UnitPriceMinor int       `json:"unit_price_minor"`
	Quantity       int       `json:"quantity"`
	LineTotalMinor int       `json:"line_total_minor"`
	Version        int       `json:"version"`
}

type Calculation struct {
	Token            string           `json:"calculation_token,omitempty"`
	Items            []CalculatedItem `json:"items"`
	SubtotalMinor    int              `json:"subtotal_minor"`
	DeliveryFeeMinor int              `json:"delivery_fee_minor"`
	TotalMinor       int              `json:"total_minor"`
	Currency         string           `json:"currency"`
	ExpiresAt        time.Time        `json:"expires_at"`
}

type Order struct {
	ID                uuid.UUID         `json:"id"`
	PublicNumber      int               `json:"public_number"`
	ClientUserID      uuid.UUID         `json:"client_user_id,omitempty"`
	FulfillmentStatus FulfillmentStatus `json:"fulfillment_status"`
	PaymentMethod     PaymentMethod     `json:"payment_method"`
	PaymentStatus     PaymentStatus     `json:"payment_status"`
	SubtotalMinor     int               `json:"subtotal_minor"`
	DeliveryFeeMinor  int               `json:"delivery_fee_minor"`
	TotalMinor        int               `json:"total_minor"`
	Currency          string            `json:"currency"`
	Phone             string            `json:"phone,omitempty"`
	Address           string            `json:"address,omitempty"`
	CustomerComment   string            `json:"customer_comment"`
	Locale            string            `json:"locale"`
	Version           int               `json:"version"`
	CreatedAt         time.Time         `json:"created_at"`
	ReadyAt           *time.Time        `json:"ready_at,omitempty"`
	DeliveredAt       *time.Time        `json:"delivered_at,omitempty"`
	CancelledAt       *time.Time        `json:"cancelled_at,omitempty"`
	Items             []OrderItem       `json:"items"`
}

type OrderItem struct {
	MenuItemID     uuid.UUID `json:"menu_item_id"`
	SnapshotTitle  string    `json:"snapshot_title"`
	UnitPriceMinor int       `json:"unit_price_minor"`
	Quantity       int       `json:"quantity"`
	LineTotalMinor int       `json:"line_total_minor"`
}
