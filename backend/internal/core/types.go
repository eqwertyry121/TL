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
	StatusReadyForPickup FulfillmentStatus = "READY_FOR_PICKUP"
	StatusDelivered      FulfillmentStatus = "DELIVERED"
	StatusCancelled      FulfillmentStatus = "CANCELLED"
)

type FulfillmentType string

const (
	FulfillmentDelivery FulfillmentType = "delivery"
	FulfillmentPickup   FulfillmentType = "pickup"
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
	ErrForbidden                 = errors.New("forbidden")
	ErrInvalidRole               = errors.New("invalid role")
	ErrInvalidInput              = errors.New("invalid input")
	ErrRestaurantClosed          = errors.New("restaurant closed")
	ErrManualDayOff              = errors.New("manual day off")
	ErrItemUnavailable           = errors.New("item unavailable")
	ErrInvalidQuantity           = errors.New("invalid quantity")
	ErrOrderStatusConflict       = errors.New("order status conflict")
	ErrActiveOrderExists         = errors.New("active order exists")
	ErrIdempotencyConflict       = errors.New("idempotency conflict")
	ErrCalculationExpired        = errors.New("calculation expired")
	ErrPaymentNotConfirmed       = errors.New("payment not confirmed")
	ErrTermsRequired             = errors.New("terms acceptance required")
	ErrContactNotVerified        = errors.New("contact not verified")
	ErrCashLocationRequired      = errors.New("cash location verification required")
	ErrCashLocationOutside       = errors.New("cash location outside delivery radius")
	ErrCashLocationInaccurate    = errors.New("cash location inaccurate")
	ErrPickupUnavailable         = errors.New("pickup unavailable")
	ErrPickupSlotUnavailable     = errors.New("pickup slot unavailable")
	ErrDeliveryTimingUnavailable = errors.New("delivery timing unavailable")
	ErrDeliverySlotUnavailable   = errors.New("delivery slot unavailable")
	ErrDeliveryTimeInvalid       = errors.New("delivery time invalid")
	ErrReservationUnavailable    = errors.New("reservation unavailable")
	ErrActiveReservationExists   = errors.New("active reservation exists")
	ErrProductionUnsafeValue     = errors.New("unsafe production config")
)

type DeliverySlotUnavailableError struct {
	NextAvailableAt   *time.Time
	QueueDelayMinutes int
}

func (e *DeliverySlotUnavailableError) Error() string { return ErrDeliverySlotUnavailable.Error() }
func (e *DeliverySlotUnavailableError) Unwrap() error { return ErrDeliverySlotUnavailable }

type User struct {
	ID             uuid.UUID `json:"id"`
	TelegramUserID int64     `json:"telegram_user_id"`
	Username       string    `json:"username"`
	FirstName      string    `json:"first_name"`
	PhotoURL       string    `json:"photo_url"`
	LanguageCode   string    `json:"language_code"`
}

type Session struct {
	Token                string    `json:"token,omitempty"`
	TokenHash            string    `json:"-"`
	UserID               uuid.UUID `json:"user_id"`
	TelegramUserID       int64     `json:"telegram_user_id"`
	Username             string    `json:"username,omitempty"`
	FirstName            string    `json:"first_name,omitempty"`
	PhotoURL             string    `json:"photo_url,omitempty"`
	DeliveryTimingAccess bool      `json:"delivery_timing_access"`
	Audience             Audience  `json:"audience"`
	ActiveRole           Role      `json:"active_role"`
	ExpiresAt            time.Time `json:"expires_at"`
}

type Settings struct {
	Timezone                      string        `json:"timezone"`
	Currency                      string        `json:"currency"`
	ManualDayOff                  bool          `json:"manual_day_off"`
	DayOffBanner                  string        `json:"day_off_banner"`
	FlatDeliveryFeeMinor          int           `json:"flat_delivery_fee_minor"`
	SupportText                   string        `json:"support_text"`
	SupportPhone                  string        `json:"support_phone"`
	TermsURL                      string        `json:"terms_url"`
	MaxItemQuantity               int           `json:"max_item_quantity"`
	MaxCommentLength              int           `json:"max_comment_length"`
	CashEnabled                   bool          `json:"cash_enabled"`
	CardEnabled                   bool          `json:"card_enabled"`
	CryptoEnabled                 bool          `json:"crypto_enabled"`
	CashLocationRequired          bool          `json:"cash_location_required"`
	RestaurantLatitude            float64       `json:"restaurant_latitude"`
	RestaurantLongitude           float64       `json:"restaurant_longitude"`
	CashLocationRadiusMeters      int           `json:"cash_location_radius_meters"`
	CashLocationTTLSeconds        int           `json:"cash_location_ttl_seconds"`
	CashLocationMaxAccuracyMeters int           `json:"cash_location_max_accuracy_meters"`
	PickupEnabled                 bool          `json:"pickup_enabled"`
	PickupAddress                 string        `json:"pickup_address"`
	PickupMapURL                  string        `json:"pickup_map_url"`
	PickupInstructionsRU          string        `json:"pickup_instructions_ru"`
	PickupInstructionsSR          string        `json:"pickup_instructions_sr"`
	PickupInstructionsEN          string        `json:"pickup_instructions_en"`
	PickupMinLeadMinutes          int           `json:"pickup_min_lead_minutes"`
	PickupSlotMinutes             int           `json:"pickup_slot_minutes"`
	PickupMaxOrdersPerSlot        int           `json:"pickup_max_orders_per_slot"`
	PickupLastTime                string        `json:"pickup_last_time"`
	DeliveryTimingEnabled         bool          `json:"delivery_timing_enabled"`
	DeliveryMinLeadMinutes        int           `json:"delivery_min_lead_minutes"`
	DeliverySlotMinutes           int           `json:"delivery_slot_minutes"`
	DeliveryMaxOrdersPerSlot      int           `json:"delivery_max_orders_per_slot"`
	DeliveryLastTargetTime        string        `json:"delivery_last_target_time"`
	Version                       int           `json:"version"`
	Schedule                      []ScheduleDay `json:"schedule,omitempty"`
}

type Runtime struct {
	ServerTime               time.Time `json:"server_time"`
	Timezone                 string    `json:"timezone"`
	AcceptingOrders          bool      `json:"accepting_orders"`
	Reason                   string    `json:"reason"`
	NextOpening              time.Time `json:"next_opening"`
	DayOffBanner             string    `json:"day_off_banner"`
	FlatDeliveryFeeMinor     int       `json:"flat_delivery_fee_minor"`
	Currency                 string    `json:"currency"`
	EnabledPayments          []string  `json:"enabled_payments"`
	SupportedLocales         []string  `json:"supported_locales"`
	SupportText              string    `json:"support_text"`
	TermsURL                 string    `json:"terms_url"`
	CashLocationRequired     bool      `json:"cash_location_required"`
	CashLocationRadiusMeters int       `json:"cash_location_radius_meters"`
	PickupEnabled            bool      `json:"pickup_enabled"`
	PickupAddress            string    `json:"pickup_address"`
	PickupMapURL             string    `json:"pickup_map_url"`
	PickupMinLeadMinutes     int       `json:"pickup_min_lead_minutes"`
	PickupSlotMinutes        int       `json:"pickup_slot_minutes"`
	PickupLastTime           string    `json:"pickup_last_time"`
	DeliveryTimingEnabled    bool      `json:"delivery_timing_enabled"`
	DeliveryMinLeadMinutes   int       `json:"delivery_min_lead_minutes"`
	DeliverySlotMinutes      int       `json:"delivery_slot_minutes"`
	DeliveryLastTargetTime   string    `json:"delivery_last_target_time"`
}

type DeliveryASAP struct {
	TargetAt          time.Time `json:"target_at"`
	WaitMinutes       int       `json:"wait_minutes"`
	QueueDelayMinutes int       `json:"queue_delay_minutes"`
}

type DeliverySlot struct {
	TargetAt          time.Time  `json:"target_at"`
	Label             string     `json:"label"`
	Available         bool       `json:"available"`
	QueueDelayMinutes int        `json:"queue_delay_minutes"`
	NextAvailableAt   *time.Time `json:"next_available_at,omitempty"`
}

type DeliverySlots struct {
	Timezone string         `json:"timezone"`
	Date     string         `json:"date"`
	ASAP     *DeliveryASAP  `json:"asap,omitempty"`
	Slots    []DeliverySlot `json:"slots"`
}

type PickupSlot struct {
	PickupAt time.Time `json:"pickup_at"`
	Label    string    `json:"label"`
}

type PickupSlots struct {
	Timezone string       `json:"timezone"`
	Date     string       `json:"date"`
	Slots    []PickupSlot `json:"slots"`
}

type ReservationStatus string

const (
	ReservationConfirmed ReservationStatus = "CONFIRMED"
	ReservationCancelled ReservationStatus = "CANCELLED"
)

type Reservation struct {
	ID              uuid.UUID         `json:"id"`
	PublicNumber    int               `json:"public_number"`
	ClientUserID    uuid.UUID         `json:"client_user_id,omitempty"`
	ClientUsername  string            `json:"client_username,omitempty"`
	ClientFirstName string            `json:"client_first_name,omitempty"`
	TableID         uuid.UUID         `json:"table_id,omitempty"`
	TableLabel      string            `json:"table_label"`
	Date            string            `json:"date"`
	StartHour       int               `json:"start_hour"`
	EndHour         int               `json:"end_hour"`
	Guests          int               `json:"guests"`
	Status          ReservationStatus `json:"status"`
	Locale          string            `json:"locale"`
	Version         int               `json:"version"`
	CreatedAt       time.Time         `json:"created_at"`
	CancelledAt     *time.Time        `json:"cancelled_at,omitempty"`
}

type ReservationAvailabilityDay struct {
	Date  string `json:"date"`
	Hours []int  `json:"hours"`
}

type ReservationAvailability struct {
	Timezone string                       `json:"timezone"`
	Guests   int                          `json:"guests"`
	Days     []ReservationAvailabilityDay `json:"days"`
}

type Category struct {
	ID        uuid.UUID  `json:"id"`
	Title     string     `json:"title"`
	SortOrder int        `json:"sort_order"`
	Items     []MenuItem `json:"items"`
}

type ScheduleDay struct {
	DayOfWeek       int    `json:"day_of_week"`
	Closed          bool   `json:"closed"`
	OpenTime        string `json:"open_time"`
	OrderCutoffTime string `json:"order_cutoff_time"`
	CloseTime       string `json:"close_time"`
	Version         int    `json:"version,omitempty"`
}

type AdminCategory struct {
	ID        uuid.UUID `json:"id"`
	TitleRU   string    `json:"title_ru"`
	TitleSR   string    `json:"title_sr"`
	TitleEN   string    `json:"title_en"`
	SortOrder int       `json:"sort_order"`
	Visible   bool      `json:"visible"`
	Archived  bool      `json:"archived"`
	ItemCount int       `json:"item_count"`
	Version   int       `json:"version"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type AdminMenuItem struct {
	ID             uuid.UUID      `json:"id"`
	CategoryID     uuid.UUID      `json:"category_id"`
	TitleRU        string         `json:"title_ru"`
	TitleSR        string         `json:"title_sr"`
	TitleEN        string         `json:"title_en"`
	DescriptionRU  string         `json:"description_ru"`
	DescriptionSR  string         `json:"description_sr"`
	DescriptionEN  string         `json:"description_en"`
	PriceMinor     int            `json:"price_minor"`
	Currency       string         `json:"currency"`
	PhotoPath      string         `json:"photo_path"`
	PhotoVariants  *PhotoVariants `json:"photo_variants,omitempty"`
	WeightText     string         `json:"weight_text"`
	MinQuantity    int            `json:"min_quantity"`
	AllergenTextRU string         `json:"allergen_text_ru"`
	AllergenTextSR string         `json:"allergen_text_sr"`
	AllergenTextEN string         `json:"allergen_text_en"`
	SortOrder      int            `json:"sort_order"`
	Visible        bool           `json:"visible"`
	Archived       bool           `json:"archived"`
	UsedInOrders   bool           `json:"used_in_orders"`
	Version        int            `json:"version"`
	CreatedAt      time.Time      `json:"created_at"`
	UpdatedAt      time.Time      `json:"updated_at"`
}

type MenuItem struct {
	ID            uuid.UUID      `json:"id"`
	CategoryID    uuid.UUID      `json:"category_id"`
	Title         string         `json:"title"`
	Description   string         `json:"description"`
	PriceMinor    int            `json:"price_minor"`
	Currency      string         `json:"currency"`
	PhotoPath     string         `json:"photo_path"`
	PhotoVariants *PhotoVariants `json:"photo_variants,omitempty"`
	WeightText    string         `json:"weight_text"`
	MinQuantity   int            `json:"min_quantity"`
	AllergenText  string         `json:"allergen_text"`
	SortOrder     int            `json:"sort_order"`
	Version       int            `json:"version"`
}

type PhotoVariants struct {
	Thumbnail PhotoVariant `json:"thumbnail"`
	Display   PhotoVariant `json:"display"`
}

type PhotoVariant struct {
	URL    string `json:"url"`
	Width  int    `json:"width"`
	Height int    `json:"height"`
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
	Token                     string           `json:"calculation_token,omitempty"`
	Items                     []CalculatedItem `json:"items"`
	FulfillmentType           FulfillmentType  `json:"fulfillment_type"`
	SubtotalMinor             int              `json:"subtotal_minor"`
	DeliveryFeeMinor          int              `json:"delivery_fee_minor"`
	TotalMinor                int              `json:"total_minor"`
	Currency                  string           `json:"currency"`
	ExpiresAt                 time.Time        `json:"expires_at"`
	OrderSubtotalMinor        int              `json:"order_subtotal_minor,omitempty"`
	OrderTotalMinor           int              `json:"order_total_minor,omitempty"`
	DeliveryTargetAt          *time.Time       `json:"delivery_target_at,omitempty"`
	DeliveryQueueDelayMinutes int              `json:"delivery_queue_delay_minutes,omitempty"`
}

type CashLocationStatus string

const (
	CashLocationPending  CashLocationStatus = "PENDING"
	CashLocationVerified CashLocationStatus = "VERIFIED"
	CashLocationRejected CashLocationStatus = "REJECTED"
	CashLocationExpired  CashLocationStatus = "EXPIRED"
	CashLocationUsed     CashLocationStatus = "USED"
)

type CashLocationChallenge struct {
	ID              uuid.UUID          `json:"id"`
	Status          CashLocationStatus `json:"status"`
	RejectionReason string             `json:"rejection_reason,omitempty"`
	DistanceMeters  *int               `json:"distance_meters,omitempty"`
	AccuracyMeters  *int               `json:"accuracy_meters,omitempty"`
	ExpiresAt       time.Time          `json:"expires_at"`
	VerifiedAt      *time.Time         `json:"verified_at,omitempty"`
	UsedAt          *time.Time         `json:"used_at,omitempty"`
	BotURL          string             `json:"bot_url,omitempty"`
	DevBypass       bool               `json:"dev_bypass,omitempty"`
}

type VerifiedContact struct {
	Verified   bool       `json:"verified"`
	Phone      string     `json:"phone,omitempty"`
	Masked     string     `json:"masked,omitempty"`
	VerifiedAt *time.Time `json:"verified_at,omitempty"`
}

type Order struct {
	ID                         uuid.UUID         `json:"id"`
	PublicNumber               int               `json:"public_number"`
	ClientUserID               uuid.UUID         `json:"client_user_id,omitempty"`
	ClientUsername             string            `json:"client_username,omitempty"`
	ClientFirstName            string            `json:"client_first_name,omitempty"`
	ClientPhotoURL             string            `json:"client_photo_url,omitempty"`
	FulfillmentType            FulfillmentType   `json:"fulfillment_type"`
	FulfillmentStatus          FulfillmentStatus `json:"fulfillment_status"`
	PaymentMethod              PaymentMethod     `json:"payment_method"`
	PaymentStatus              PaymentStatus     `json:"payment_status"`
	SubtotalMinor              int               `json:"subtotal_minor"`
	DeliveryFeeMinor           int               `json:"delivery_fee_minor"`
	TotalMinor                 int               `json:"total_minor"`
	Currency                   string            `json:"currency"`
	Phone                      string            `json:"phone,omitempty"`
	Address                    string            `json:"address,omitempty"`
	CustomerComment            string            `json:"customer_comment"`
	Locale                     string            `json:"locale"`
	Version                    int               `json:"version"`
	CreatedAt                  time.Time         `json:"created_at"`
	KitchenStartedAt           *time.Time        `json:"kitchen_started_at,omitempty"`
	CourierStartedAt           *time.Time        `json:"courier_started_at,omitempty"`
	ReadyAt                    *time.Time        `json:"ready_at,omitempty"`
	PickupAt                   *time.Time        `json:"pickup_at,omitempty"`
	PickupOriginalAt           *time.Time        `json:"pickup_original_at,omitempty"`
	PickupCookAt               *time.Time        `json:"pickup_cook_at,omitempty"`
	PickupAddress              string            `json:"pickup_address,omitempty"`
	PickupInstructions         string            `json:"pickup_instructions,omitempty"`
	DeliveryTimeMode           string            `json:"delivery_time_mode,omitempty"`
	DeliveryRequestedAt        *time.Time        `json:"delivery_requested_at,omitempty"`
	DeliveryTargetAt           *time.Time        `json:"delivery_target_at,omitempty"`
	DeliveryQueueDelayMinutes  int               `json:"delivery_queue_delay_minutes"`
	EstimatedReadyAt           *time.Time        `json:"estimated_ready_at,omitempty"`
	EstimatedReadyUpdatedAt    *time.Time        `json:"estimated_ready_updated_at,omitempty"`
	EstimatedReadyBy           *uuid.UUID        `json:"estimated_ready_by,omitempty"`
	DeliveredAt                *time.Time        `json:"delivered_at,omitempty"`
	CancelledAt                *time.Time        `json:"cancelled_at,omitempty"`
	CashLocationVerifiedAt     *time.Time        `json:"cash_location_verified_at,omitempty"`
	CashLocationDistanceMeters *int              `json:"cash_location_distance_meters,omitempty"`
	CanAddItems                bool              `json:"can_add_items"`
	AddItemsUntil              *time.Time        `json:"add_items_until,omitempty"`
	AddItemsReason             string            `json:"add_items_reason,omitempty"`
	LatestAddition             *OrderAddition    `json:"latest_addition,omitempty"`
	Items                      []OrderItem       `json:"items"`
	Events                     []OrderEvent      `json:"events,omitempty"`
}

type OrderSummary struct {
	ID                         uuid.UUID         `json:"id"`
	PublicNumber               int               `json:"public_number"`
	ClientUsername             string            `json:"client_username,omitempty"`
	ClientFirstName            string            `json:"client_first_name,omitempty"`
	ClientPhotoURL             string            `json:"client_photo_url,omitempty"`
	FulfillmentType            FulfillmentType   `json:"fulfillment_type"`
	FulfillmentStatus          FulfillmentStatus `json:"fulfillment_status"`
	PaymentMethod              PaymentMethod     `json:"payment_method"`
	PaymentStatus              PaymentStatus     `json:"payment_status"`
	SubtotalMinor              int               `json:"subtotal_minor"`
	DeliveryFeeMinor           int               `json:"delivery_fee_minor"`
	TotalMinor                 int               `json:"total_minor"`
	Currency                   string            `json:"currency"`
	Locale                     string            `json:"locale"`
	Version                    int               `json:"version"`
	CreatedAt                  time.Time         `json:"created_at"`
	ReadyAt                    *time.Time        `json:"ready_at,omitempty"`
	PickupAt                   *time.Time        `json:"pickup_at,omitempty"`
	DeliveryTimeMode           string            `json:"delivery_time_mode,omitempty"`
	DeliveryRequestedAt        *time.Time        `json:"delivery_requested_at,omitempty"`
	DeliveryTargetAt           *time.Time        `json:"delivery_target_at,omitempty"`
	DeliveryQueueDelayMinutes  int               `json:"delivery_queue_delay_minutes"`
	EstimatedReadyAt           *time.Time        `json:"estimated_ready_at,omitempty"`
	DeliveredAt                *time.Time        `json:"delivered_at,omitempty"`
	CancelledAt                *time.Time        `json:"cancelled_at,omitempty"`
	CashLocationVerifiedAt     *time.Time        `json:"cash_location_verified_at,omitempty"`
	CashLocationDistanceMeters *int              `json:"cash_location_distance_meters,omitempty"`
	CanAddItems                bool              `json:"can_add_items"`
	AddItemsUntil              *time.Time        `json:"add_items_until,omitempty"`
	AddItemsReason             string            `json:"add_items_reason,omitempty"`
	LatestAddition             *OrderAddition    `json:"latest_addition,omitempty"`
}

type OrderItem struct {
	MenuItemID        uuid.UUID  `json:"menu_item_id"`
	SnapshotTitle     string     `json:"snapshot_title"`
	UnitPriceMinor    int        `json:"unit_price_minor"`
	Quantity          int        `json:"quantity"`
	LineTotalMinor    int        `json:"line_total_minor"`
	AdditionID        *uuid.UUID `json:"addition_id,omitempty"`
	AdditionRevision  int        `json:"addition_revision,omitempty"`
	AdditionCreatedAt *time.Time `json:"addition_created_at,omitempty"`
}

type OrderAddition struct {
	ID            uuid.UUID `json:"id"`
	Revision      int       `json:"revision"`
	SubtotalMinor int       `json:"subtotal_minor"`
	Currency      string    `json:"currency"`
	CreatedAt     time.Time `json:"created_at"`
}

type OrderEvent struct {
	ID         uuid.UUID `json:"id"`
	OrderID    uuid.UUID `json:"order_id"`
	FromStatus string    `json:"from_status"`
	ToStatus   string    `json:"to_status"`
	Action     string    `json:"action"`
	ActorRole  string    `json:"actor_role"`
	Reason     string    `json:"reason"`
	CreatedAt  time.Time `json:"created_at"`
}

type StaffMember struct {
	ID             uuid.UUID `json:"id"`
	TelegramUserID int64     `json:"telegram_user_id"`
	DisplayLabel   string    `json:"display_label"`
	Role           Role      `json:"role"`
	Active         bool      `json:"active"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}

type AdminDashboard struct {
	Runtime            Runtime   `json:"runtime"`
	NewOrders          int       `json:"new_orders"`
	OutForDelivery     int       `json:"out_for_delivery"`
	ReadyForPickup     int       `json:"ready_for_pickup"`
	OrdersToday        int       `json:"orders_today"`
	RevenueTodayMinor  int       `json:"revenue_today_minor"`
	NotificationErrors []string  `json:"notification_errors"`
	GeneratedAt        time.Time `json:"generated_at"`
}

type AnalyticsSummary struct {
	AllOrders                        int `json:"all_orders"`
	DeliveredOrders                  int `json:"delivered_orders"`
	CancelledOrders                  int `json:"cancelled_orders"`
	RevenueMinor                     int `json:"revenue_minor"`
	AverageCheckMinor                int `json:"average_check_minor"`
	DeliverySlotFillPercent          int `json:"delivery_slot_fill_percent"`
	AverageDeliveryQueueDelayMinutes int `json:"average_delivery_queue_delay_minutes"`
	AverageReadyPlanDeviationMinutes int `json:"average_ready_plan_deviation_minutes"`
}

type AnalyticsBreakdown struct {
	Key            string `json:"key"`
	Count          int    `json:"count"`
	DeliveredCount int    `json:"delivered_count"`
	PaidCount      int    `json:"paid_count"`
	CancelledCount int    `json:"cancelled_count"`
	RevenueMinor   int    `json:"revenue_minor"`
}

type TopDish struct {
	Title        string `json:"title"`
	Quantity     int    `json:"quantity"`
	RevenueMinor int    `json:"revenue_minor"`
}

type DailyAnalyticsRow struct {
	Day          string `json:"day"`
	Orders       int    `json:"orders"`
	Delivered    int    `json:"delivered"`
	Cancelled    int    `json:"cancelled"`
	RevenueMinor int    `json:"revenue_minor"`
}

type AdminAnalytics struct {
	Currency    string               `json:"currency"`
	From        time.Time            `json:"from"`
	To          time.Time            `json:"to"`
	GeneratedAt time.Time            `json:"generated_at"`
	Summary     AnalyticsSummary     `json:"summary"`
	Statuses    []AnalyticsBreakdown `json:"statuses"`
	Payments    []AnalyticsBreakdown `json:"payments"`
	TopDishes   []TopDish            `json:"top_dishes"`
	DailyRows   []DailyAnalyticsRow  `json:"daily_rows"`
}

type AuditEntry struct {
	ID         uuid.UUID      `json:"id"`
	ActorRole  string         `json:"actor_role"`
	Action     string         `json:"action"`
	TargetType string         `json:"target_type"`
	TargetID   *uuid.UUID     `json:"target_id,omitempty"`
	Reason     string         `json:"reason"`
	Before     map[string]any `json:"before,omitempty"`
	After      map[string]any `json:"after,omitempty"`
	CreatedAt  time.Time      `json:"created_at"`
}
